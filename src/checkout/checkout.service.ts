import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { appBaseUrl } from '../common/app-url.util';
import { FirebaseService } from '../firebase/firebase.service';
import { PlanoAtual } from '../professor/entities/professor.entity';
import { ProfessorService } from '../professor/professor.service';
import {
  AbacatePayService,
  StatusPagamento,
} from './abacate-pay.service';
import { CobrancaRepository } from './cobranca.repository';
import {
  CobrancaEntity,
  MetodoCobranca,
  TipoCobranca,
} from './entities/cobranca.entity';
import { valorDoPlano, valorSlot } from './precos';
import { IniciarSlotDto } from './dto/iniciar-slot.dto';
import { IniciarUpgradeDto } from './dto/iniciar-upgrade.dto';

const DIA_MS = 86_400_000;
/** Duracao concedida a cada pagamento aprovado (ciclo mensal PIX one-time). */
const DIAS_ASSINATURA = 30;

/**
 * Resposta do inicio de um checkout. Para admin/gratuito o plano ja e concedido
 * (`concedido: true`); para cobranca real, devolve os dados de pagamento (PIX
 * inline ou URL do cartao) e o `billingId` para o front acompanhar o status.
 */
export interface CheckoutResposta {
  concedido?: boolean;
  billingId?: string;
  metodo?: MetodoCobranca;
  status?: StatusPagamento;
  valorCentavos?: number;
  brCode?: string;
  brCodeBase64?: string;
  expiraEm?: string;
  url?: string;
}

@Injectable()
export class CheckoutService {
  constructor(
    private readonly abacate: AbacatePayService,
    private readonly cobrancas: CobrancaRepository,
    private readonly professores: ProfessorService,
    private readonly firebase: FirebaseService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Inicia a troca de plano. Admin nao passa pelo gateway (concede na hora);
   * downgrade para o gratuito tambem e imediato. Caso contrario, cria a cobranca.
   */
  async iniciarUpgrade(
    uid: string,
    dto: IniciarUpgradeDto,
  ): Promise<CheckoutResposta> {
    const prof = await this.professores.getProfile(uid);
    const valor = valorDoPlano(dto.plano);

    // Isento de gateway: admin (regra §7.7) ou destino gratuito (sem cobranca).
    if (prof.isAdmin || valor <= 0) {
      await this.professores.alterarPlano(uid, dto.plano);
      return { concedido: true };
    }

    return this.criarCobranca(uid, {
      tipo: 'UPGRADE',
      planoAlvo: dto.plano,
      valorCentavos: valor,
      metodo: dto.metodo,
      descricao: `Tichr ${dto.plano}`,
      produtoExternalId: `plano-${dto.plano.toLowerCase()}`,
      nome: `Plano Tichr ${dto.plano}`,
      cupom: dto.cupom,
    });
  }

  /** Inicia a compra de uma vaga avulsa (compra unica). Admin concede na hora. */
  async iniciarSlot(
    uid: string,
    dto: IniciarSlotDto,
  ): Promise<CheckoutResposta> {
    const prof = await this.professores.getProfile(uid);
    if (prof.isAdmin) {
      await this.professores.comprarSlotAvulso(uid);
      return { concedido: true };
    }

    return this.criarCobranca(uid, {
      tipo: 'SLOT',
      valorCentavos: valorSlot(),
      metodo: dto.metodo,
      descricao: 'Vaga de turma avulsa',
      produtoExternalId: 'slot-avulso',
      nome: 'Vaga de turma avulsa (Tichr)',
    });
  }

  private async criarCobranca(
    uid: string,
    params: {
      tipo: TipoCobranca;
      planoAlvo?: PlanoAtual;
      valorCentavos: number;
      metodo: MetodoCobranca;
      descricao: string;
      produtoExternalId: string;
      nome: string;
      cupom?: string;
    },
  ): Promise<CheckoutResposta> {
    const base = appBaseUrl(this.config);
    let id: string;
    let resposta: CheckoutResposta;

    if (params.metodo === 'PIX') {
      const pix = await this.abacate.criarCobrancaPix({
        valorCentavos: params.valorCentavos,
        descricao: params.descricao,
        metadata: { professorId: uid, tipo: params.tipo },
      });
      id = pix.id;
      resposta = {
        billingId: pix.id,
        metodo: 'PIX',
        status: pix.status,
        valorCentavos: params.valorCentavos,
        brCode: pix.brCode,
        brCodeBase64: pix.brCodeBase64,
        expiraEm: pix.expiraEm,
      };
    } else {
      const checkout = await this.abacate.criarCheckoutCartao({
        produtoExternalId: params.produtoExternalId,
        nome: params.nome,
        valorCentavos: params.valorCentavos,
        professorId: uid,
        // Volta para o painel de plano — o webhook ja concede; a tela recarrega.
        completionUrl: `${base}/configuracoes/plano?pago=1`,
        returnUrl: `${base}/planos`,
        cupons: params.cupom ? [params.cupom] : undefined,
      });
      id = checkout.id;
      resposta = {
        billingId: checkout.id,
        metodo: 'CARTAO',
        status: checkout.status,
        valorCentavos: params.valorCentavos,
        url: checkout.url,
      };
    }

    await this.cobrancas.salvar(
      new CobrancaEntity({
        id,
        professorId: uid,
        tipo: params.tipo,
        planoAlvo: params.planoAlvo,
        valorCentavos: params.valorCentavos,
        metodo: params.metodo,
        cupom: params.cupom,
        status: 'PENDING',
        criadoEm: new Date().toISOString(),
      }),
    );
    await this.professores.registrarBillingAtual(uid, id);
    return resposta;
  }

  /**
   * Status de uma cobranca (para o polling do front). Se ainda pendente,
   * reconcilia com o gateway; se o gateway ja marcou pago, concede na hora
   * (resiliencia caso o webhook atrase/falhe — a concessao e idempotente).
   */
  async status(uid: string, billingId: string): Promise<{ status: StatusPagamento }> {
    const cobranca = await this.assertDono(uid, billingId);
    if (cobranca.status !== 'PENDING') {
      return { status: cobranca.status };
    }

    const atual =
      cobranca.metodo === 'PIX'
        ? await this.abacate.consultarStatusPix(billingId)
        : await this.abacate.consultarStatusCheckout(billingId);

    if (atual === 'PAID') {
      await this.confirmarPagamento(billingId);
    } else if (atual !== 'PENDING') {
      await this.cobrancas.update(billingId, { status: atual });
    }
    return { status: atual };
  }

  /** Simula o pagamento de uma cobranca PIX (apenas em devMode, para testes). */
  async simular(uid: string, billingId: string): Promise<{ status: StatusPagamento }> {
    if (!this.abacate.devMode) {
      throw new ForbiddenException({
        code: 'SIMULACAO_INDISPONIVEL',
        message: 'Simulacao de pagamento so existe em ambiente de testes.',
      });
    }
    const cobranca = await this.assertDono(uid, billingId);
    if (cobranca.metodo !== 'PIX') {
      throw new BadRequestException('So e possivel simular cobrancas PIX.');
    }
    await this.abacate.simularPagamentoPix(billingId);
    await this.confirmarPagamento(billingId);
    return { status: 'PAID' };
  }

  /**
   * Processa um evento do webhook do gateway. Trata `billing.paid` (PIX ou
   * cartao) e concede o plano/slot da cobranca correspondente.
   */
  async processarWebhook(body: {
    event?: string;
    data?: {
      pixQrCode?: { id?: string };
      billing?: { id?: string };
    };
  }): Promise<void> {
    if (body?.event !== 'billing.paid') return;
    const billingId = body.data?.pixQrCode?.id ?? body.data?.billing?.id;
    if (!billingId) return;
    await this.confirmarPagamento(billingId);
  }

  /** Dono da cobranca ou 404 (nunca revela cobranca de outro professor). */
  private async assertDono(
    uid: string,
    billingId: string,
  ): Promise<CobrancaEntity> {
    const cobranca = await this.cobrancas.findById(billingId);
    if (!cobranca || cobranca.professorId !== uid) {
      throw new NotFoundException('Cobranca nao encontrada.');
    }
    return cobranca;
  }

  /**
   * Concede o beneficio da cobranca numa transacao idempotente: se a cobranca
   * ja esta `PAID`, nao credita de novo (protege contra webhook duplicado). O
   * plano ganha vencimento hoje+30d (renovacao estende a partir do vencimento
   * futuro, se houver); o slot incrementa a contagem permanente.
   */
  private async confirmarPagamento(billingId: string): Promise<void> {
    const db = this.firebase.firestore;
    const cobRef = db.collection('cobrancas').doc(billingId);
    const agora = new Date();
    const nowISO = agora.toISOString();

    await db.runTransaction(async (tx) => {
      const cobSnap = await tx.get(cobRef);
      if (!cobSnap.exists) return;
      const cob = cobSnap.data() as CobrancaEntity;
      if (cob.status === 'PAID') return; // idempotencia — ja creditado.

      const profRef = db.collection('professores').doc(cob.professorId);
      const profSnap = await tx.get(profRef);
      const prof = (profSnap.data() ?? {}) as {
        assinaturaAte?: string;
        slotsAdicionaisComprados?: number;
      };

      let update: Record<string, unknown>;
      if (cob.tipo === 'UPGRADE') {
        const vencAtual = prof.assinaturaAte
          ? new Date(prof.assinaturaAte).getTime()
          : 0;
        const inicio = vencAtual > agora.getTime() ? vencAtual : agora.getTime();
        update = {
          planoAtual: cob.planoAlvo,
          assinaturaAte: new Date(inicio + DIAS_ASSINATURA * DIA_MS).toISOString(),
          ultimoPagamentoEm: nowISO,
          statusAssinatura: 'ATIVA',
          billingIdAtual: cob.id,
        };
      } else {
        update = {
          slotsAdicionaisComprados: (prof.slotsAdicionaisComprados ?? 0) + 1,
        };
      }

      tx.set(profRef, update, { merge: true });
      tx.update(cobRef, { status: 'PAID', pagoEm: nowISO });
    });
  }
}

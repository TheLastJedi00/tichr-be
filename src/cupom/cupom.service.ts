import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AbacatePayService } from '../checkout/abacate-pay.service';
import { FirebaseService } from '../firebase/firebase.service';
import type { ProfessorEntity } from '../professor/entities/professor.entity';
import { CupomRepository } from './cupom.repository';
import { CupomEntity, TipoDesconto } from './entities/cupom.entity';
import { CreateCupomDto } from './dto/create-cupom.dto';
import { UpdateCupomDto } from './dto/update-cupom.dto';

const MS_POR_MES = 30 * 86_400_000;

export interface ResultadoAplicacao {
  aplicado: true;
  tipo: CupomEntity['tipo'];
  planoAtual?: string;
  cortesiaAte?: string;
}

/**
 * Motor de cupons: CRUD (admin) + aplicacao no checkout (professor).
 * A aplicacao roda numa transacao: revalida o limite e incrementa `usos`
 * junto da concessao ao professor, evitando corrida/uso duplicado.
 */
@Injectable()
export class CupomService {
  private readonly logger = new Logger(CupomService.name);

  constructor(
    private readonly repo: CupomRepository,
    private readonly firebase: FirebaseService,
    private readonly abacate: AbacatePayService,
  ) {}

  listar(): Promise<CupomEntity[]> {
    return this.repo.listarTodos();
  }

  async criar(dto: CreateCupomDto): Promise<CupomEntity> {
    const codigo = CupomEntity.normalizar(dto.codigo);
    const existente = await this.repo.findByCodigo(codigo);
    if (existente) {
      throw new BadRequestException('Ja existe um cupom com esse codigo.');
    }

    // Desconto no gateway: usa o informado, ou cortesia total (100% off) como
    // default — cortesia (PLANO_GRATIS/MESES_GRATIS) concede fora do pagamento,
    // mas o cupom fica espelhado no gateway para rastreio e uso no cartao.
    const discountKind: TipoDesconto = dto.discountKind ?? 'PERCENTAGE';
    const discount = dto.discount ?? 100;
    const abacateCupomId = await this.espelharNoGateway(codigo, {
      discountKind,
      discount,
      tipo: dto.tipo,
      maxUsos: dto.maxUsos,
    });

    return this.repo.create({
      codigo,
      tipo: dto.tipo,
      planoConcedido: dto.planoConcedido,
      meses: dto.meses,
      maxUsos: dto.maxUsos,
      ativo: dto.ativo ?? true,
      usos: 0,
      discountKind,
      discount,
      abacateCupomId,
    } as Omit<CupomEntity, 'id'>);
  }

  /**
   * Cria o cupom espelho na Abacate Pay. **Best-effort**: sem chave ou com falha
   * do gateway, o cupom local ainda e criado (sem `abacateCupomId`) — a gestao de
   * cupons nao pode quebrar por causa da indisponibilidade do gateway.
   */
  private async espelharNoGateway(
    codigo: string,
    dados: {
      discountKind: TipoDesconto;
      discount: number;
      tipo: string;
      maxUsos?: number;
    },
  ): Promise<string | undefined> {
    if (!this.abacate.disponivel()) return undefined;
    try {
      const criado = await this.abacate.criarCupom({
        codigo,
        discount: dados.discount,
        discountKind: dados.discountKind,
        notes: `Tichr ${dados.tipo}`,
        maxRedeems: dados.maxUsos ?? -1,
      });
      return criado.id;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Cupom ${codigo} nao espelhado no gateway: ${msg}`);
      return undefined;
    }
  }

  async atualizar(id: string, dto: UpdateCupomDto): Promise<void> {
    const dados: Partial<CupomEntity> = { ...dto };
    if (dto.codigo) dados.codigo = CupomEntity.normalizar(dto.codigo);
    await this.repo.update(id, dados);
  }

  remover(id: string): Promise<void> {
    return this.repo.delete(id);
  }

  /** Aplica o cupom ao professor autenticado (transacao). */
  async aplicar(uid: string, codigoRaw: string): Promise<ResultadoAplicacao> {
    const codigo = CupomEntity.normalizar(codigoRaw);
    const cupom = await this.repo.findByCodigo(codigo);
    if (!cupom || !cupom.estaValido()) {
      throw new BadRequestException({
        code: 'CUPOM_INVALIDO',
        message: 'Cupom invalido, inativo ou esgotado.',
      });
    }

    const update: Partial<ProfessorEntity> = {};
    if (cupom.planoConcedido) update.planoAtual = cupom.planoConcedido;
    if (cupom.meses && cupom.meses > 0) {
      update.cortesiaAte = new Date(
        Date.now() + cupom.meses * MS_POR_MES,
      ).toISOString();
    }

    const db = this.firebase.firestore;
    await db.runTransaction(async (tx) => {
      const cupomRef = db.collection('cupons').doc(cupom.id);
      const fresh = await tx.get(cupomRef);
      const data = fresh.data() ?? {};
      const usos = (data.usos as number) ?? 0;
      const maxUsos = data.maxUsos as number | undefined;
      if (data.ativo === false || (maxUsos != null && usos >= maxUsos)) {
        throw new BadRequestException({
          code: 'CUPOM_INVALIDO',
          message: 'Cupom invalido, inativo ou esgotado.',
        });
      }
      tx.update(cupomRef, { usos: usos + 1 });
      tx.set(db.collection('professores').doc(uid), update, { merge: true });
    });

    return {
      aplicado: true,
      tipo: cupom.tipo,
      planoAtual: update.planoAtual,
      cortesiaAte: update.cortesiaAte,
    };
  }
}

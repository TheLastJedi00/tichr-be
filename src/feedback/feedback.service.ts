import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { appBaseUrl } from '../common/app-url.util';
import { FirebaseService } from '../firebase/firebase.service';
import { AtualizarFeedbackDto } from './dto/atualizar-feedback.dto';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { montarEmailFeedback } from './email-template';
import { FeedbackEntity } from './entities/feedback.entity';
import { FeedbackRepository } from './feedback.repository';
import { enviarEmail } from './resend';

/** Remetente default; so vale se o dominio estiver verificado na Resend. */
const REMETENTE_PADRAO = 'Tichr <nao-responda@tichr.com.br>';

@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);

  constructor(
    private readonly repo: FeedbackRepository,
    private readonly firebase: FirebaseService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Quem e o professor, segundo o servidor. O nome vive no Firestore e o e-mail
   * so no Firebase Auth, entao sao duas leituras — feitas em paralelo porque
   * nenhuma depende da outra.
   *
   * Nenhuma das duas e obrigatoria: um professor sem `nomeExibicao` (ou cuja
   * conta perdeu o e-mail) ainda tem direito de reclamar. Falha aqui degrada o
   * cabecalho do relato, nunca o relato.
   */
  private async identificar(
    uid: string,
  ): Promise<{ nome: string; email: string }> {
    const [doc, user] = await Promise.all([
      this.firebase.firestore.collection('professores').doc(uid).get(),
      this.firebase.auth.getUser(uid).catch(() => null),
    ]);
    const nome = (doc.data()?.nomeExibicao as string | undefined) ?? '';
    return { nome, email: user?.email ?? '' };
  }

  /** Destinatarios do alerta (env separada por virgula, como CORS_ORIGINS). */
  private destinatarios(): string[] {
    return (this.config.get<string>('ADMIN_NOTIFICATION_EMAILS') ?? '')
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);
  }

  /**
   * Alerta a equipe. Nao lanca: quem chama nao esta esperando (o professor ja
   * recebeu o 201) e um feedback salvo vale mais do que um alerta entregue.
   *
   * Sem chave ou sem destinatario, so avisa e sai — espelha o GEMINI_API_KEY,
   * menos o 503: o professor nao pode perder o relato porque o e-mail do admin
   * esta mal configurado. Em dev, onde ninguem configura a chave, o canal
   * continua funcionando ponta a ponta e o feedback aparece na inbox.
   */
  private async notificar(feedback: FeedbackEntity): Promise<void> {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    const para = this.destinatarios();

    if (!apiKey || para.length === 0) {
      this.logger.warn(
        `Feedback ${feedback.id} salvo, alerta nao enviado: ${!apiKey ? 'RESEND_API_KEY' : 'ADMIN_NOTIFICATION_EMAILS'} nao configurada.`,
      );
      return;
    }

    const { assunto, html } = montarEmailFeedback(
      feedback,
      appBaseUrl(this.config),
    );

    await enviarEmail(apiKey, {
      de: this.config.get<string>('RESEND_FROM') ?? REMETENTE_PADRAO,
      para,
      assunto,
      html,
    });

    // Marca o envio para a inbox poder mostrar "alerta nao enviado" quando o
    // campo faltar. Sem isto, a falha morreria no log — que e exatamente o bug
    // de design que o PR #54 consertou no reset de senha.
    await this.repo.update(feedback.id, {
      notificadoEm: new Date().toISOString(),
    });
  }

  async criar(uid: string, dto: CreateFeedbackDto): Promise<FeedbackEntity> {
    const { nome, email } = await this.identificar(uid);

    const salvo = await this.repo.create(
      new FeedbackEntity({
        professorId: uid,
        professorNome: nome,
        professorEmail: email,
        categoria: dto.categoria,
        mensagem: dto.mensagem.trim(),
        rota: dto.rota,
        userAgent: dto.userAgent,
        status: 'PENDENTE',
        criadoEm: new Date().toISOString(),
      }),
    );

    // Deliberadamente NAO aguardado: a resposta 201 nao espera a latencia de um
    // provedor externo. Mas fire-and-forget puro esconde falha — o feedback
    // existiria e ninguem saberia —, entao o catch registra.
    void this.notificar(salvo).catch((erro: unknown) =>
      this.logger.error(
        `Falha ao alertar sobre o feedback ${salvo.id}: ${String(erro)}`,
      ),
    );

    return salvo;
  }

  /** Caixa de entrada do admin (mais novos primeiro). */
  listar(): Promise<FeedbackEntity[]> {
    return this.repo.listarRecentes();
  }

  /**
   * Triagem. Campo ausente no DTO nao e tocado — um PATCH so de status nao
   * apaga a nota que ja estava la, e vice-versa.
   */
  async atualizar(
    id: string,
    dto: AtualizarFeedbackDto,
  ): Promise<FeedbackEntity> {
    const atual = await this.repo.findById(id);
    if (!atual) {
      throw new NotFoundException('Feedback nao encontrado.');
    }

    const mudancas: Partial<FeedbackEntity> = {
      atualizadoEm: new Date().toISOString(),
    };
    if (dto.status !== undefined) {
      mudancas.status = dto.status;
    }
    if (dto.notaInterna !== undefined) {
      mudancas.notaInterna = dto.notaInterna.trim();
    }

    await this.repo.update(id, mudancas);
    return new FeedbackEntity({ ...atual, ...mudancas });
  }
}

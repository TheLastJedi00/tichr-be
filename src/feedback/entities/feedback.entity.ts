/** Triagem do relato. Nasce sempre em PENDENTE (o admin move o resto). */
export type StatusFeedback = 'PENDENTE' | 'EM_ANALISE' | 'RESOLVIDO';

/** Natureza do relato, escolhida pelo professor no envio. */
export type CategoriaFeedback = 'BUG' | 'SUGESTAO' | 'DUVIDA' | 'ELOGIO';

/** Rotulo humano de cada categoria — usado no assunto do e-mail e na inbox. */
const ROTULOS: Record<CategoriaFeedback, string> = {
  BUG: 'Relato de Bug',
  SUGESTAO: 'Sugestao de Melhoria',
  DUVIDA: 'Duvida Tecnica',
  ELOGIO: 'Elogio',
};

/**
 * Um relato enviado pelo professor (colecao `feedbacks`).
 *
 * A identidade (`professorId`, `professorNome`, `professorEmail`) NAO vem do
 * corpo da requisicao: o cliente so manda o que so ele sabe (a rota em que
 * estava e o User-Agent). Quem preenche o resto e o service, a partir do token —
 * fosse do cliente, bastaria editar o POST para abrir chamado no nome de outro.
 *
 * A colecao e privada: fica no deny-all das Firestore Rules e so o Admin SDK a
 * le. A inbox do admin a consome por REST (`GET /admin/feedbacks`), nunca por
 * onSnapshot — o front nao tem sessao do Firebase Auth, entao as rules nao
 * conseguiriam distinguir um admin de um curioso.
 */
export class FeedbackEntity {
  id: string;
  professorId: string;
  professorNome: string;
  professorEmail: string;
  categoria: CategoriaFeedback;
  mensagem: string;

  /** Rota do Angular no momento do clique (`router.url`). */
  rota: string;

  /** User-Agent do navegador, para reproduzir o bug no aparelho certo. */
  userAgent: string;

  status: StatusFeedback;
  criadoEm: string;

  /** Anotacao do admin, invisivel para o professor. */
  notaInterna?: string;

  /** Ultima mudanca de status/nota. */
  atualizadoEm?: string;

  /**
   * Quando o alerta por e-mail saiu. Ausente = o disparo falhou (ou nao havia
   * chave configurada) — a inbox mostra isso, senao a falha morreria no log.
   */
  notificadoEm?: string;

  constructor(partial: Partial<FeedbackEntity> = {}) {
    Object.assign(this, partial);
  }

  get resolvido(): boolean {
    return this.status === 'RESOLVIDO';
  }

  /** "Relato de Bug", "Elogio"… — o literal cru nunca vaza para o template. */
  rotuloCategoria(): string {
    return ROTULOS[this.categoria] ?? this.categoria;
  }
}

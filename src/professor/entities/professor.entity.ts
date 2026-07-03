/** Nivel academico/assinatura do professor. */
export type PlanoAtual = 'ESTAGIARIO' | 'GRADUADO' | 'MESTRE' | 'PHD';

/**
 * Limite base de turmas ativas simultaneas por plano.
 * `Infinity` = ilimitado (Mestre e PhD).
 */
export const LIMITE_BASE_PLANO: Record<PlanoAtual, number> = {
  ESTAGIARIO: 2,
  GRADUADO: 5,
  MESTRE: Infinity,
  PHD: Infinity,
};

/** Hierarquia dos planos (indice = nivel). */
export const ORDEM_PLANO: PlanoAtual[] = [
  'ESTAGIARIO',
  'GRADUADO',
  'MESTRE',
  'PHD',
];

/**
 * Perfil do professor. Documento salvo em `professores/{uid}`
 * (o uid do Firebase Auth e a chave do documento).
 */
export class ProfessorEntity {
  uid: string;
  nomeExibicao?: string;
  disciplina?: string;
  bio?: string;

  /** Handle publico unico (estilo @usuario) — chave de busca do portal do aluno. */
  username?: string;

  /** Competencias/disciplinas que o professor leciona. */
  disciplinas?: string[];

  /** Nivel de assinatura atual. Novos professores entram como ESTAGIARIO. */
  planoAtual: PlanoAtual = 'ESTAGIARIO';

  /** Vagas de turma compradas avulsas, somadas ao limite base do plano. */
  slotsAdicionaisComprados = 0;

  constructor(partial: Partial<ProfessorEntity> = {}) {
    Object.assign(this, partial);
  }

  get temNome(): boolean {
    return !!this.nomeExibicao && this.nomeExibicao.trim().length > 0;
  }

  /** Gamificacao (pontuacao, ranking, portal) e exclusiva do plano PhD. */
  get podeGamificar(): boolean {
    return this.planoAtual === 'PHD';
  }

  /** Verdadeiro se o plano atual alcanca (>=) o `minimo` na hierarquia. */
  atendePlano(minimo: PlanoAtual): boolean {
    return ORDEM_PLANO.indexOf(this.planoAtual) >= ORDEM_PLANO.indexOf(minimo);
  }

  /**
   * Limite efetivo de turmas ativas: base do plano + slots avulsos comprados.
   * Retorna Infinity para planos ilimitados (Mestre/PhD).
   */
  get limiteTurmas(): number {
    const base = LIMITE_BASE_PLANO[this.planoAtual] ?? LIMITE_BASE_PLANO.ESTAGIARIO;
    return base + (this.slotsAdicionaisComprados ?? 0);
  }
}

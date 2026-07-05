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

/** Intervalo minimo (dias) entre trocas do @username (trava de identificador). */
export const USERNAME_COOLDOWN_DIAS = 60;

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

  /** Ultima troca do @username (ISO). Base da trava de cooldown de 60 dias. */
  lastUsernameChange?: string;

  /** URL publica da foto de perfil (Firebase Storage). Vazio = usa placeholder. */
  avatarUrl?: string;

  /** Competencias/disciplinas que o professor leciona. */
  disciplinas?: string[];

  /** Nivel de assinatura atual. Novos professores entram como ESTAGIARIO. */
  planoAtual: PlanoAtual = 'ESTAGIARIO';

  /** Vagas de turma compradas avulsas, somadas ao limite base do plano. */
  slotsAdicionaisComprados = 0;

  /** Marca de soft-delete (ISO). Preenchido = conta desativada pelo admin. */
  desativadoEm?: string;

  /** Meses de cortesia concedidos por cupom (ISO da data limite), se houver. */
  cortesiaAte?: string;

  /**
   * Acesso ao backoffice. **Fonte de verdade do admin** (Firestore): gravado só
   * pelo Admin SDK (backend) ou manualmente pelo dono no Firestore Console — o
   * `UpdateProfileDto` não expõe o campo, então o professor não se auto-promove.
   */
  isAdmin?: boolean;

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
   * Dias que faltam para o professor poder trocar o @username de novo.
   * 0 = liberado (nunca trocou, ou ja passaram 60 dias desde a ultima troca).
   */
  diasParaTrocarUsername(agora: Date = new Date()): number {
    if (!this.lastUsernameChange) return 0;
    const desde = new Date(this.lastUsernameChange).getTime();
    if (Number.isNaN(desde)) return 0;
    const passados = (agora.getTime() - desde) / 86_400_000;
    const restam = Math.ceil(USERNAME_COOLDOWN_DIAS - passados);
    return restam > 0 ? restam : 0;
  }

  /** Verdadeiro se o professor esta liberado para trocar o @username agora. */
  podeAlterarUsername(agora: Date = new Date()): boolean {
    return this.diasParaTrocarUsername(agora) === 0;
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

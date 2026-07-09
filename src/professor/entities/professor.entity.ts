import { LIMITE_TURMAS_ATIVAS } from '../../common/pin.util';

/** Nivel academico/assinatura do professor. */
export type PlanoAtual = 'ESTAGIARIO' | 'GRADUADO' | 'MESTRE' | 'PHD';

/**
 * Limite base de turmas ativas simultaneas por plano.
 *
 * O teto tecnico e 99 para todos os planos pagos: o PIN da turma e de 2 digitos
 * ('01'..'99') e nao pode repetir entre turmas ativas (pool `LIMITE_TURMAS_ATIVAS`).
 * Por isso nenhum plano e "ilimitado" — Mestre/PhD tambem sao 99. O Estagiario
 * fica na carga reduzida de 5.
 */
export const LIMITE_BASE_PLANO: Record<PlanoAtual, number> = {
  ESTAGIARIO: 5,
  GRADUADO: LIMITE_TURMAS_ATIVAS,
  MESTRE: LIMITE_TURMAS_ATIVAS,
  PHD: LIMITE_TURMAS_ATIVAS,
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

  /** Última geração de dicas por IA do Tichr Wor (ISO). Base do rate limit 1×/dia. */
  worIaUltimoUso?: string;

  /** Última geração de perguntas por IA do Tichr Qlick (ISO). Rate limit 1×/dia (separado do Wor). */
  qlickIaUltimoUso?: string;

  /** Aceite dos Termos de Uso no cadastro (ISO). Registro de consentimento LGPD. */
  aceiteTermosEm?: string;

  /** Aceite da Política de Privacidade no cadastro (ISO). Registro LGPD. */
  aceitePrivacidadeEm?: string;

  /** Versão dos documentos legais aceita no cadastro (auditoria de consentimento). */
  versaoDocumentosLegais?: string;

  constructor(partial: Partial<ProfessorEntity> = {}) {
    Object.assign(this, partial);
  }

  /** Verdadeiro se o professor já usou a IA do Wor no dia `hojeISO` (YYYY-MM-DD). */
  usouIaWorHoje(hojeISO: string): boolean {
    return (this.worIaUltimoUso ?? '').slice(0, 10) === hojeISO;
  }

  /** Verdadeiro se o professor já usou a IA do Qlick no dia `hojeISO` (YYYY-MM-DD). */
  usouIaQlickHoje(hojeISO: string): boolean {
    return (this.qlickIaUltimoUso ?? '').slice(0, 10) === hojeISO;
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
   * Limite efetivo de turmas ativas: base do plano + slots avulsos comprados,
   * sempre limitado ao teto tecnico do PIN de 2 digitos (99). Nenhum plano e
   * ilimitado — o pool de PINs curtos e o teto real.
   */
  get limiteTurmas(): number {
    const base = LIMITE_BASE_PLANO[this.planoAtual] ?? LIMITE_BASE_PLANO.ESTAGIARIO;
    return Math.min(base + (this.slotsAdicionaisComprados ?? 0), LIMITE_TURMAS_ATIVAS);
  }
}

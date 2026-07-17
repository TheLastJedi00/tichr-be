import { LIMITE_TURMAS_ATIVAS } from '../../common/pin.util';

/** Nivel academico/assinatura do professor. */
export type PlanoAtual = 'ESTAGIARIO' | 'GRADUADO' | 'MESTRE' | 'PHD';

/**
 * Situacao da assinatura paga.
 * - `ATIVA`: em dia (ou plano gratuito, ou admin, ou cortesia vigente).
 * - `PENDENTE`: aguardando a confirmacao de um pagamento em aberto.
 * - `INADIMPLENTE`: venceu sem renovar — acesso rebaixado, dados preservados.
 * - `CANCELADA`: cancelada explicitamente.
 */
export type StatusAssinatura = 'ATIVA' | 'PENDENTE' | 'INADIMPLENTE' | 'CANCELADA';

/** Data de hoje em `YYYY-MM-DD` (base das comparacoes de vigencia). */
function hojeISO(): string {
  return new Date().toISOString().slice(0, 10);
}

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

  /** Id do cliente no gateway (Abacate Pay), reutilizado entre cobrancas. */
  abacateCustomerId?: string;

  /** Id da ultima cobranca aberta no gateway (para reconciliacao/polling). */
  billingIdAtual?: string;

  /**
   * Situacao da assinatura. Novos professores (ESTAGIARIO) entram `ATIVA` — o
   * plano gratuito nunca vence. Atualizado pelo webhook do gateway.
   */
  statusAssinatura: StatusAssinatura = 'ATIVA';

  /**
   * Vencimento da assinatura paga (ISO). Gravado a cada pagamento aprovado
   * (hoje + 30 dias). **Ausente = conta que nunca passou pelo gateway** (mock/
   * legado ou tier gratuito): nesse caso a vigencia e presumida (nao rebaixa).
   */
  assinaturaAte?: string;

  /** Data do ultimo pagamento aprovado (ISO). */
  ultimoPagamentoEm?: string;

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

  /** Última geração de questões por IA do Tichr Isolateus (ISO). Rate limit 1×/dia (contador próprio). */
  isolateusIaUltimoUso?: string;

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

  /** Verdadeiro se o professor já usou a IA do Isolateus no dia `hojeISO` (YYYY-MM-DD). */
  usouIaIsolateusHoje(hojeISO: string): boolean {
    return (this.isolateusIaUltimoUso ?? '').slice(0, 10) === hojeISO;
  }

  get temNome(): boolean {
    return !!this.nomeExibicao && this.nomeExibicao.trim().length > 0;
  }

  /**
   * Assinatura vigente em `hoje` (YYYY-MM-DD). Admin, tier gratuito e cortesia
   * valida contam como vigentes. **Sem `assinaturaAte` a vigencia e presumida**:
   * a conta nunca passou pelo gateway (mock/legado), entao nao rebaixamos.
   */
  assinaturaVigente(hoje: string = hojeISO()): boolean {
    if (this.isAdmin) return true;
    if (this.planoAtual === 'ESTAGIARIO') return true;
    if (this.cortesiaAte && this.cortesiaAte.slice(0, 10) >= hoje) return true;
    if (!this.assinaturaAte) return true;
    return this.assinaturaAte.slice(0, 10) >= hoje;
  }

  /**
   * Plano que vale de fato para os gates. Igual ao contratado enquanto a
   * assinatura esta vigente; cai para ESTAGIARIO quando vence (inadimplencia),
   * **sem** reescrever `planoAtual` no banco (dados preservados — spec 012 §4).
   */
  planoEfetivo(hoje: string = hojeISO()): PlanoAtual {
    return this.assinaturaVigente(hoje) ? this.planoAtual : 'ESTAGIARIO';
  }

  /** Situacao derivada da vigencia (para a view): ATIVA enquanto em dia. */
  statusDerivado(hoje: string = hojeISO()): StatusAssinatura {
    return this.assinaturaVigente(hoje) ? 'ATIVA' : 'INADIMPLENTE';
  }

  /** Gamificacao (pontuacao, ranking, portal) e exclusiva do plano PhD. */
  get podeGamificar(): boolean {
    return this.planoEfetivo() === 'PHD';
  }

  /** Verdadeiro se o plano **efetivo** alcanca (>=) o `minimo` na hierarquia. */
  atendePlano(minimo: PlanoAtual): boolean {
    return ORDEM_PLANO.indexOf(this.planoEfetivo()) >= ORDEM_PLANO.indexOf(minimo);
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
    const base =
      LIMITE_BASE_PLANO[this.planoEfetivo()] ?? LIMITE_BASE_PLANO.ESTAGIARIO;
    return Math.min(base + (this.slotsAdicionaisComprados ?? 0), LIMITE_TURMAS_ATIVAS);
  }
}

/** Constantes do motor da invasão. Fonte única dos números do jogo. */
export const ISOLATEUS = {
  /** Barra de Esperança da vila. Zerou, a Ameaça venceu. */
  ESPERANCA_INICIAL: 100,
  /** Um setor danificado (a vila errou a defesa). 6 setores × 15 = 90. */
  DANO_SABOTAGEM: 15,
  /** Um morador abduzido na calada da noite. */
  DANO_ABDUCAO: 10,
  /** A vila trancou um inocente na Quarentena ("dano severo"). */
  DANO_INOCENTE: 20,

  /** Pontos por acerto + bônus máximo de rapidez (espelha o Qlick). */
  PONTOS_ACERTO: 1000,
  BONUS_RAPIDEZ: 500,
  /** Bônus de "Vitória de Partida" para o lado vencedor (§7). */
  BONUS_VITORIA: 1000,

  /** Mínimo de investigadores reais para iniciar (§2). */
  MIN_REAIS: 4,
  /** Abaixo disto a vila recebe NPCs (Névoa de Guerra). */
  LIMIAR_NEVOA: 10,
  /** Total de setores vitais. */
  TOTAL_SETORES: 6,

  /** Janelas cronometradas (contadas pelo cliente; o servidor só revalida). */
  LIMITE_DEBATE_MS: 90_000,
  LIMITE_VOTO_MS: 60_000,
  /** Margem de segurança ao revalidar o prazo disparado pelo projetor. */
  MARGEM_TEMPO_MS: 2_000,
} as const;

export type StatusIsolateus =
  | 'LOBBY'
  | 'TURNO_AMEACA'
  | 'QUESTAO_ATIVA'
  | 'RESULTADO_RODADA'
  | 'QUARENTENA_DEBATE'
  | 'QUARENTENA_VOTO'
  | 'ENCERRADO';

/**
 * Um habitante da vila — real ou virtual, **indistinguíveis aqui de propósito**.
 * O `id` é opaco (UUID): o vínculo com o `alunoId` (e portanto quem é NPC) mora
 * só no cofre `isolateus_segredos`, fora do alcance do DevTools.
 */
export interface Habitante {
  id: string;
  nome: string;
  vivo: boolean;
  preso: boolean;
}

/** Um dos 6 setores vitais. */
export interface Setor {
  id: string;
  nome: string;
  intacto: boolean;
}

/**
 * Uma mensagem do Chat de Rumores. `FORJADO` é o rumor do Alienígena — publicado
 * sob o nome de um NPC, exatamente como qualquer outro: o tipo existe para o
 * histórico do servidor, e o cliente não deve usá-lo para destacar nada além do
 * `SINAL` (que a spec quer visivelmente marcado).
 */
export interface Rumor {
  id: string;
  autorNome: string;
  texto: string;
  tipo: 'RUMOR' | 'FORJADO' | 'SINAL';
}

/** Uma fala do debate da Quarentena. */
export interface MensagemDebate {
  id: string;
  autorNome: string;
  texto: string;
}

/** O alerta global que abre a rodada. */
export interface AlertaRodada {
  tipo: 'SABOTAGEM' | 'ABDUCAO';
  texto: string;
}

/** O card de resultado da rodada (defesa mantida × dano sofrido). */
export interface ResumoRodada {
  seq: number;
  defendida: boolean;
  texto: string;
}

/** O veredito da Quarentena (sem revelar a identidade do inocente — §5). */
export interface VereditoQuarentena {
  presoNome: string;
  eraAmeaca: boolean;
  texto: string;
}

/** O veredito final, com o motivo técnico explícito (§8). */
export interface Veredito {
  lado: 'VILA' | 'AMEACA';
  motivo: string;
}

export interface PlacarItem {
  posicao: number;
  alunoId: string;
  nome: string;
  pontos: number;
}

/**
 * Tichr Isolateus — a CAMADA PÚBLICA de uma partida (`isolateus_partidas/{id}`).
 *
 * O backend (Admin SDK) é a única fonte de escrita; os clientes leem via
 * `onSnapshot`. **Nada aqui pode entregar o mistério**: não há `alienAlunoId`,
 * não há flag de NPC, o `corretaIndex` só aparece depois da rodada resolvida e
 * o placar só é publicado no encerramento (um ranking ao vivo denunciaria quem
 * é real, já que NPC não pontua). O que é segredo vive em `isolateus_segredos`.
 */
export class IsolateusMatchEntity {
  id: string;
  jogoId: string;
  professorId: string;
  turmaId?: string;
  nome: string;

  status: StatusIsolateus;
  criadaEm: string | null;

  /** Barra de Esperança (0..100). */
  esperanca: number;
  setores: Setor[];
  habitantes: Habitante[];

  rodada: number; // -1 no lobby, 0-based depois
  totalRodadas: number;
  duracaoSegundos: number;

  /** Base do cronômetro no cliente (questão, debate ou votação). */
  faseIniciadaEm: string | null;

  questaoPublica: { enunciado: string; alternativas: string[] } | null;
  /** Só preenchido em `RESULTADO_RODADA` — nunca durante a questão. */
  corretaIndex: number | null;

  alerta: AlertaRodada | null;
  rumores: Rumor[];
  debate: MensagemDebate[];
  resumoRodada: ResumoRodada | null;

  /**
   * Rodada da última Quarentena convocada (null = nenhuma ainda). A vila pode
   * convocar uma por rodada: sempre depois da noite, nunca duas vezes seguidas
   * na mesma — prender em série até acertar trivializaria a dedução.
   */
  quarentenaRodada: number | null;
  vereditoQuarentena: VereditoQuarentena | null;
  /** Quantos já votaram (contagem apenas — o voto em si é secreto). */
  votosRecebidos: number;
  /** Quantos já pularam o debate (contagem apenas — quem pulou é segredo). */
  pulosRecebidos: number;

  /**
   * Pseudônimos do lobby. **Apagado ao iniciar**: mantê-lo permitiria casar os
   * nomes com a lista de habitantes e deduzir quem é NPC.
   */
  inscritos: Array<{ alunoId: string; nome: string }>;

  veredito: Veredito | null;
  rankingFinal: PlacarItem[];

  constructor(partial: Partial<IsolateusMatchEntity> = {}) {
    Object.assign(this, partial);
  }

  /** Habitantes ainda na vila (não abduzidos, não presos). */
  get vivos(): Habitante[] {
    return this.habitantes.filter((h) => h.vivo && !h.preso);
  }

  get setoresIntactos(): number {
    return this.setores.filter((s) => s.intacto).length;
  }

  /** Habitantes que saíram da vila (abduzidos ou presos). */
  get foraDaVila(): number {
    return this.habitantes.length - this.vivos.length;
  }
}

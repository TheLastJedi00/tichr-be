import { LogPontuacaoJogador } from '../../common/log-pontuacao';

export type StatusPartida =
  | 'LOBBY'
  | 'QUESTAO_ATIVA'
  | 'RANKING_PARCIAL'
  | 'ENCERRADO';

export interface InscritoPartida {
  alunoId: string;
  nome: string;
}

export interface PlacarItem {
  alunoId: string;
  nome: string;
  pontos: number;
}

/**
 * Estado EM TEMPO REAL de uma sessão do Tichr Qlick (coleção `qlick_partidas`).
 * O backend (Admin SDK) é a ÚNICA fonte de escrita; os clientes leem via
 * `onSnapshot`. O documento expõe só o que o aluno pode ver: durante uma questão
 * ativa mostra `perguntaPublica` (sem a correta); a correta (`corretaIndex`) só
 * aparece no `RANKING_PARCIAL`.
 */
export class PartidaEntity {
  id: string;
  qlickId: string;
  professorId: string;
  turmaId?: string;
  titulo: string;

  status: StatusPartida;
  /**
   * Desmarcado no lobby, a partida é casual: placar e log normais, sem crédito
   * no ranking da turma (spec 027 §3). Ausente (partida antiga) vale.
   */
  valeRanking?: boolean;
  /**
   * Cada aluno recebe as perguntas em ordem própria (spec 031). Escolhido no
   * lobby; ausente (partida antiga) = false. Ligado, o enunciado sai do doc.
   */
  embaralharPerguntas?: boolean;
  /** Cada aluno vê as alternativas em ordem própria (spec 031). Ausente = false. */
  embaralharAlternativas?: boolean;
  /** Quantos inscritos já responderam a rodada corrente. Zera a cada rodada. */
  respondidosRodada?: number;
  /** ISO de quando a partida foi criada (lobby aberto). Filtra sessões velhas. */
  criadaEm?: string | null;
  /** Índice da pergunta corrente (0-based); -1 no lobby. */
  perguntaAtual: number;
  totalPerguntas: number;
  duracaoSegundos: number;
  /** ISO de quando a pergunta corrente foi ativada (para o cronômetro). */
  perguntaIniciadaEm?: string | null;

  /**
   * Quando o professor pausou a partida (ISO); `null`/ausente = rodando
   * (028 §4). Pausada, só Retomar passa; os relógios das telas param.
   */
  pausadaEm?: string | null;

  /** Visão pública da pergunta corrente (sem a resposta). */
  perguntaPublica?: { enunciado: string; alternativas: string[] } | null;
  /** Correta revelada apenas no RANKING_PARCIAL. */
  corretaIndex?: number | null;

  inscritos: InscritoPartida[];
  /** Placar acumulado e ranking parcial da rodada. */
  placar: PlacarItem[];
  rankingParcial?: PlacarItem[];
  rankingFinal?: Array<{ posicao: number } & PlacarItem>;
  /** De onde veio cada ponto (spec 027 §1). Gravado só no encerramento. */
  logPontuacao?: LogPontuacaoJogador[];

  constructor(partial: Partial<PartidaEntity> = {}) {
    Object.assign(this, partial);
  }
}

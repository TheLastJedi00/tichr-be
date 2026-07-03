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
  /** ISO de quando a partida foi criada (lobby aberto). Filtra sessões velhas. */
  criadaEm?: string | null;
  /** Índice da pergunta corrente (0-based); -1 no lobby. */
  perguntaAtual: number;
  totalPerguntas: number;
  duracaoSegundos: number;
  /** ISO de quando a pergunta corrente foi ativada (para o cronômetro). */
  perguntaIniciadaEm?: string | null;

  /** Visão pública da pergunta corrente (sem a resposta). */
  perguntaPublica?: { enunciado: string; alternativas: string[] } | null;
  /** Correta revelada apenas no RANKING_PARCIAL. */
  corretaIndex?: number | null;

  inscritos: InscritoPartida[];
  /** Placar acumulado e ranking parcial da rodada. */
  placar: PlacarItem[];
  rankingParcial?: PlacarItem[];
  rankingFinal?: Array<{ posicao: number } & PlacarItem>;

  constructor(partial: Partial<PartidaEntity> = {}) {
    Object.assign(this, partial);
  }
}

/** Uma pergunta do Qlick com suas alternativas e o índice da correta. */
export interface PerguntaQlick {
  enunciado: string;
  alternativas: string[];
  corretaIndex: number;
}

/**
 * Tichr Qlick: a DEFINIÇÃO de um questionário gamificado (coleção `qlicks`).
 * O estado em tempo real de uma sessão vive em `qlick_partidas` (outra fase).
 */
export class QlickEntity {
  id: string;
  professorId: string;
  titulo: string;

  /** Metadados/planejamento (opcionais). */
  disciplina?: string;
  topicoId?: string;
  turmaId?: string;

  /** Limite de tempo por questão (segundos; default 60). */
  duracaoSegundos: number;

  perguntas: PerguntaQlick[];

  constructor(partial: Partial<QlickEntity> = {}) {
    Object.assign(this, partial);
  }
}

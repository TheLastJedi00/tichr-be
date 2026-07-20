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

  /**
   * Aula (1..N) à qual o jogo foi fixado manualmente, quando a turma não usa
   * plano de tópicos. Sem `topicoId`, é o que faz o jogo aparecer no card da
   * respectiva aula no painel do professor (ENH-001/002).
   */
  numeroAula?: number;

  /** Legado: turma única. Substituído por `turmaIds` (N:N). */
  turmaId?: string;

  /** Turmas às quais o Qlick foi atribuído (relação N:N por referência de IDs). */
  turmaIds?: string[];

  /** Limite de tempo por questão (segundos; default 60). */
  duracaoSegundos: number;

  perguntas: PerguntaQlick[];

  constructor(partial: Partial<QlickEntity> = {}) {
    Object.assign(this, partial);
  }

  /** Turmas atribuídas (N:N + legado `turmaId`), sem duplicatas. */
  get turmas(): string[] {
    const ids = [...(this.turmaIds ?? [])];
    if (this.turmaId && !ids.includes(this.turmaId)) {
      ids.push(this.turmaId);
    }
    return ids;
  }
}

/** Uma questão do Isolateus: o enigma que defende (ou condena) um setor da vila. */
export interface QuestaoIsolateus {
  enunciado: string;
  alternativas: string[];
  corretaIndex: number;
}

/**
 * Tichr Isolateus: a DEFINIÇÃO de uma investigação (coleção `isolateus_jogos`).
 *
 * Guarda as 10 questões que servem de base para as tentativas de sabotagem e
 * defesa. **É a coleção do segredo**: o `corretaIndex` mora aqui e o cliente
 * nunca a lê (fechada nas Firestore Rules). O estado em tempo real de uma
 * partida vive em `isolateus_partidas`, sem a resposta correta.
 */
export class IsolateusJogoEntity {
  id: string;
  professorId: string;
  nome: string;

  /** Metadados/planejamento (opcionais, espelhando Qlick e Wor). */
  disciplina?: string;
  topicoId?: string;

  /** Legado: turma única. Substituído por `turmaIds` (N:N). */
  turmaId?: string;

  /** Turmas às quais a investigação foi atribuída (N:N por referência de IDs). */
  turmaIds?: string[];

  /** Limite de tempo por questão (segundos; default 60). */
  duracaoSegundos: number;

  questoes: QuestaoIsolateus[];

  constructor(partial: Partial<IsolateusJogoEntity> = {}) {
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

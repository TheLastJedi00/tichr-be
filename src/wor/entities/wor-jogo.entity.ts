/** Uma palavra do baralho (onda) com até 3 cartas de dica progressivas. */
export interface PalavraWor {
  id: string;
  palavra: string;
  /** Cartas de dica (da mais difícil para a mais fácil); no máximo 3. */
  dicas: string[];
}

/**
 * Tichr Wor: a DEFINIÇÃO de uma batalha (coleção `wor_jogos`) — o "arsenal" de
 * palavras/dicas montado pelo professor. O estado em tempo real de uma partida
 * vive em `matches/{id}` + subcoleção `teams` (estado fragmentado, outra fase).
 *
 * Metadados e vínculo de turma espelham o Qlick: `disciplina`/`topicoId` são o
 * planejamento (opcional) e `turmaIds` é a relação N:N (por referência de IDs).
 */
export class WorJogoEntity {
  id: string;
  professorId: string;
  nome: string;

  /** Metadados/planejamento (opcionais). `topicoId` referencia um `Topico`. */
  disciplina?: string;
  topicoId?: string;

  /** Aula (1..N) fixada manualmente quando a turma não usa tópicos (ENH-001/002). */
  numeroAula?: number;

  /** Legado: turma única. Substituído por `turmaIds` (N:N). */
  turmaId?: string;

  /** Turmas às quais a batalha foi atribuída (relação N:N por referência de IDs). */
  turmaIds?: string[];

  /** Baralho de ondas (ordem = ordem de aparição na aula). */
  palavras: PalavraWor[];

  constructor(partial: Partial<WorJogoEntity> = {}) {
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

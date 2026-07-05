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
 */
export class WorJogoEntity {
  id: string;
  professorId: string;
  nome: string;

  /** Contexto para a IA e organização. */
  disciplina?: string;
  topico: string;

  /** Baralho de ondas (ordem = ordem de aparição na aula). */
  palavras: PalavraWor[];

  constructor(partial: Partial<WorJogoEntity> = {}) {
    Object.assign(this, partial);
  }
}

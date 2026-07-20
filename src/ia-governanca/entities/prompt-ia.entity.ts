import { JogoIa } from '../../professor/entities/professor.entity';

/**
 * Prompt de IA de um jogo (coleção `prompts_ia`, doc id = o próprio jogo:
 * `qlick` | `wor` | `isolateus`). Guarda um **template com tokens** editável pelo
 * admin, sem novo deploy. Se o doc não existir, o `PromptIaService` cai no
 * template default embutido no código — então a coleção pode nascer vazia.
 *
 * Tokens disponíveis no template (substituídos em runtime):
 * - `{contexto}` — disciplina/tópico compostos (linha some quando ausentes)
 * - `{instrucao}` — a instrução que o professor digitou
 * - Qlick: `{qtdPerguntas}`, `{qtdAlternativas}`
 * - Wor: `{qtdPalavras}`, `{qtdDicas}`
 * - Isolateus: `{qtdQuestoes}`, `{qtdAlternativas}`
 */
export class PromptIaEntity {
  /** = o jogo (qlick|wor|isolateus). */
  id: string;
  jogo: JogoIa;
  template: string;
  atualizadoEm?: string;

  constructor(partial: Partial<PromptIaEntity> = {}) {
    Object.assign(this, partial);
  }
}

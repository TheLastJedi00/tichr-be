/**
 * Periodo de ferias, com escopo isolado:
 * - **global** (sem turmaId nem instituicaoId): vale para todas as turmas;
 * - **por instituicao** (instituicaoId): vale so para as turmas daquela escola;
 * - **por turma** (turmaId): vale so para aquela turma.
 * Modulos fechados pulam os dias dentro do intervalo; grade fixa marca CANCELADA.
 */
export class FeriasEntity {
  id: string;
  professorId: string;
  turmaId?: string;
  instituicaoId?: string;
  dataInicio: string; // 'YYYY-MM-DD'
  dataFim: string; // 'YYYY-MM-DD'
  descricao?: string;

  constructor(partial: Partial<FeriasEntity> = {}) {
    Object.assign(this, partial);
  }

  /** So ferias globais dominam o calendario (contorno vermelho). */
  get isGlobal(): boolean {
    return !this.turmaId && !this.instituicaoId;
  }
}

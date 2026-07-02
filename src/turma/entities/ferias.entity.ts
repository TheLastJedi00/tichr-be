/**
 * Periodo de ferias. Escopo global (turmaId ausente) vale para todas as
 * turmas do professor; com turmaId, vale apenas para aquela turma.
 * Modulos fechados pulam automaticamente os dias dentro do intervalo.
 */
export class FeriasEntity {
  id: string;
  professorId: string;
  turmaId?: string;
  dataInicio: string; // 'YYYY-MM-DD'
  dataFim: string; // 'YYYY-MM-DD'
  descricao?: string;

  constructor(partial: Partial<FeriasEntity> = {}) {
    Object.assign(this, partial);
  }

  get isGlobal(): boolean {
    return !this.turmaId;
  }
}

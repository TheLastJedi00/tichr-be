export type EscopoExcecao = 'GLOBAL' | 'ESCOLA' | 'PESSOAL';

/**
 * ExcecaoCalendario: evento que impede a ocorrencia de uma aula numa data.
 * Pode ser global (feriado), de escola (conselho) ou pessoal (imprevisto).
 */
export class ExcecaoEntity {
  id: string;
  professorId: string;

  /** Data bloqueada no formato 'YYYY-MM-DD'. */
  data: string;

  motivo: string;
  escopo: EscopoExcecao;

  constructor(partial: Partial<ExcecaoEntity> = {}) {
    Object.assign(this, partial);
  }
}

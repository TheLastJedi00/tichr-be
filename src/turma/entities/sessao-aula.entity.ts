export type StatusSessao = 'AGENDADA' | 'CANCELADA' | 'REALIZADA';

/**
 * SessaoAula: instancia real de uma aula que aparece no calendario.
 * Gerada pelo cruzamento Turma + RegraRecorrencia - Excecao.
 */
export class SessaoAulaEntity {
  id: string;
  turmaId: string;
  professorId: string;

  /** Ordem da aula dentro da turma (1..N). */
  numero: number;

  /** Data da aula no formato 'YYYY-MM-DD'. */
  data: string;

  status: StatusSessao;

  constructor(partial: Partial<SessaoAulaEntity> = {}) {
    Object.assign(this, partial);
  }
}

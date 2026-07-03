/**
 * Topico (backlog) de uma disciplina — a atomizacao do escopo geral (Mestre+).
 * Alocado a uma SessaoAula por numero via AlocacaoEntity.
 */
export class TopicoEntity {
  id: string;
  professorId: string;
  disciplina: string;
  nome: string;

  constructor(partial: Partial<TopicoEntity> = {}) {
    Object.assign(this, partial);
  }
}

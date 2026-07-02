/**
 * Aluno de uma turma (lista de chamada interna do professor). Nao e um usuario
 * do Firebase Auth — na Fase 3 ganha PIN e XP para acessar o portal.
 */
export class AlunoEntity {
  id: string;
  turmaId: string;
  nome: string;

  /** Tags livres de perfil (ex.: 'lider', 'iniciante') usadas para dinamicas. */
  tagsPerfil?: string[];

  constructor(partial: Partial<AlunoEntity> = {}) {
    Object.assign(this, partial);
  }
}

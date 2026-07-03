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

  /** Equipe persistente a que o aluno pertence; null/ausente = sem equipe. */
  equipeId?: string | null;

  /** PIN de 4 digitos para o aluno entrar no portal (Plano PhD). */
  pinAcesso?: string;

  /** Pontuacao acumulada (gamificacao). */
  xpTotal = 0;

  constructor(partial: Partial<AlunoEntity> = {}) {
    Object.assign(this, partial);
  }
}

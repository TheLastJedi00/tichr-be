/** Papeis de acesso do sistema. */
export type Role = 'PROFESSOR' | 'STUDENT';

/** Payload do JWT customizado emitido para alunos (Plano PhD). */
export interface StudentTokenPayload {
  role: 'STUDENT';
  alunoId: string;
  turmaId: string;
}

/**
 * Principal autenticado anexado em request.user pelo AuthGuard.
 * Professores vem do Firebase (uid); alunos do JWT customizado (alunoId+turmaId).
 */
export interface RequestUser {
  uid: string;
  role: Role;
  alunoId?: string;
  turmaId?: string;
}

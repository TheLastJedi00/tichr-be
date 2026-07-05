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
 *
 * `admin` e uma flag ortogonal ao `role` (nao um papel exclusivo): um admin
 * continua sendo PROFESSOR para todas as rotas normais e ganha acesso ao
 * backoffice via `AdminGuard`. Derivada do custom claim `admin` do Firebase ou
 * da lista `ADMIN_EMAILS` (bootstrap).
 */
export interface RequestUser {
  uid: string;
  role: Role;
  email?: string;
  admin?: boolean;
  alunoId?: string;
  turmaId?: string;
}

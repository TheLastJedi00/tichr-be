import { SetMetadata } from '@nestjs/common';
import { Role } from './auth.types';

export const ROLES_KEY = 'roles';

/**
 * Restringe uma rota a determinados papeis. Sem o decorator, o AuthGuard
 * assume PROFESSOR (protege por padrao os endpoints do painel do professor).
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

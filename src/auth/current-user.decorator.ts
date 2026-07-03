import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { RequestUser } from './auth.types';

/**
 * Injeta o uid do professor autenticado (preenchido pelo AuthGuard em request.user).
 */
export const ProfessorId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const user = request['user'] as RequestUser;
    return user.uid;
  },
);

/** Injeta o principal autenticado completo (professor ou aluno). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request['user'] as RequestUser;
  },
);

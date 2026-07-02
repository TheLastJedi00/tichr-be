import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { DecodedIdToken } from 'firebase-admin/auth';

/**
 * Injeta o uid do professor autenticado (preenchido pelo AuthGuard em request.user).
 */
export const ProfessorId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const user = request['user'] as DecodedIdToken;
    return user.uid;
  },
);

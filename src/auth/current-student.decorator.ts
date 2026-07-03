import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { RequestUser } from './auth.types';

/**
 * Injeta { alunoId, turmaId } do aluno autenticado (preenchido pelo AuthGuard
 * a partir do JWT de aluno). Use apenas em rotas com @Roles('STUDENT').
 */
export const CurrentStudent = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): { alunoId: string; turmaId: string } => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const user = request['user'] as RequestUser;
    return { alunoId: user.alunoId!, turmaId: user.turmaId! };
  },
);

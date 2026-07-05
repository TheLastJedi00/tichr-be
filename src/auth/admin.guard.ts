import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { RequestUser } from './auth.types';

/**
 * Protege o backoffice: exige que o principal (ja resolvido pelo AuthGuard
 * global) tenha a flag `admin`. Use com `@UseGuards(AdminGuard)` nos
 * controllers de `/admin`.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request['user'] as RequestUser | undefined;
    if (!user?.admin) {
      throw new ForbiddenException('Acesso restrito a administradores.');
    }
    return true;
  }
}

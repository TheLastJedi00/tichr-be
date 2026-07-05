import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { Role, RequestUser } from './auth.types';
import { IS_PUBLIC_KEY } from './public.decorator';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('Token de autenticacao ausente.');
    }

    const user = await this.resolveUser(token);

    // Papeis permitidos: default PROFESSOR (protege o painel do professor).
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) ?? ['PROFESSOR'];

    if (!roles.includes(user.role)) {
      throw new ForbiddenException('Acesso nao permitido para este perfil.');
    }

    request['user'] = user;
    return true;
  }

  /**
   * Resolve o principal: tenta o ID token do Firebase (professor); se falhar,
   * tenta o JWT customizado de aluno (STUDENT). Erro em ambos = 401.
   */
  private async resolveUser(token: string): Promise<RequestUser> {
    try {
      const decoded = await this.authService.verifyToken(token);
      const admin =
        decoded.admin === true || this.authService.isAdminEmail(decoded.email);
      return {
        uid: decoded.uid,
        role: 'PROFESSOR',
        email: decoded.email,
        admin,
      };
    } catch {
      // nao e um token de professor; tenta como aluno abaixo.
    }

    try {
      const payload = this.authService.verifyStudentToken(token);
      return {
        uid: payload.alunoId,
        role: 'STUDENT',
        alunoId: payload.alunoId,
        turmaId: payload.turmaId,
      };
    } catch {
      throw new UnauthorizedException('Token invalido ou expirado.');
    }
  }

  private extractToken(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}

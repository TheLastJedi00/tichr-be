import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { SEM_VERIFICACAO_KEY } from './sem-verificacao.decorator';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * A trava de e-mail verificado no AuthGuard.
 *
 * O teste central e o do 403: se a checagem morasse dentro do `resolveUser`, o
 * catch que tenta o token de aluno a engoliria e o professor receberia
 * `401 Token invalido` — indistinguivel de sessao expirada, mandando o front
 * para o /login em laco em vez da tela de confirmacao.
 */
describe('AuthGuard — trava de e-mail nao verificado', () => {
  function montarContexto(metadados: Record<string, boolean> = {}) {
    const request: Record<string, unknown> = {
      headers: { authorization: 'Bearer tok' },
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => 'handler',
      getClass: () => 'class',
    } as unknown as ExecutionContext;

    const reflector = {
      getAllAndOverride: (chave: string) => metadados[chave],
    } as unknown as Reflector;

    return { context, reflector, request };
  }

  function authComEmailVerificado(emailVerified: boolean): AuthService {
    return {
      verifyToken: jest.fn().mockResolvedValue({ uid: 'uid1', email_verified: emailVerified }),
      verifyStudentToken: jest.fn(),
    } as unknown as AuthService;
  }

  it('professor NAO verificado: 403 EMAIL_NAO_VERIFICADO (e nao 401)', async () => {
    const { context, reflector } = montarContexto();
    const guard = new AuthGuard(authComEmailVerificado(false), reflector);

    const erro = await guard.canActivate(context).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ForbiddenException);
    expect(erro).not.toBeInstanceOf(UnauthorizedException);
    expect((erro as ForbiddenException).getResponse()).toMatchObject({
      code: 'EMAIL_NAO_VERIFICADO',
    });
  });

  it('professor verificado: passa', async () => {
    const { context, reflector, request } = montarContexto();
    const guard = new AuthGuard(authComEmailVerificado(true), reflector);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toMatchObject({
      uid: 'uid1',
      role: 'PROFESSOR',
      emailVerified: true,
    });
  });

  it('@SemVerificacao: nao verificado passa (tela de espera precisa dessas rotas)', async () => {
    const { context, reflector } = montarContexto({ [SEM_VERIFICACAO_KEY]: true });
    const guard = new AuthGuard(authComEmailVerificado(false), reflector);

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('@Public: nem chega a olhar o token', async () => {
    const { context, reflector } = montarContexto({ [IS_PUBLIC_KEY]: true });
    const auth = authComEmailVerificado(false);
    const guard = new AuthGuard(auth, reflector);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(auth.verifyToken).not.toHaveBeenCalled();
  });

  it('aluno: a trava nao se aplica (nao tem e-mail)', async () => {
    const { context, reflector } = montarContexto();
    const auth = {
      verifyToken: jest.fn().mockRejectedValue(new Error('nao e professor')),
      verifyStudentToken: jest
        .fn()
        .mockReturnValue({ role: 'STUDENT', alunoId: 'a1', turmaId: 't1' }),
    } as unknown as AuthService;
    // Rota de aluno: @Roles('STUDENT').
    const reflectorAluno = {
      getAllAndOverride: (chave: string) =>
        chave === 'roles' ? ['STUDENT'] : undefined,
    } as unknown as Reflector;

    const guard = new AuthGuard(auth, reflectorAluno);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    void reflector;
  });
});

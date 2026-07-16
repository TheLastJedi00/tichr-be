import { Response } from 'express';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { COOKIE_REFRESH } from './sessao.cookie';

/**
 * O contrato que sustenta a decisao de sessao: o refresh token sai no cookie
 * HttpOnly e NAO no corpo. Se um dia alguem devolver `refreshToken` no JSON, o
 * ganho todo (XSS nao exfiltra a sessao) evapora em silencio — dai o teste.
 */
describe('AuthController — sessao em cookie', () => {
  const sessao = {
    token: 'id-token',
    refreshToken: 'refresh-secreto',
    expiresIn: 3600,
    uid: 'uid1',
    email: 'a@b.com',
  };

  function montarRes() {
    return {
      cookie: jest.fn(),
      clearCookie: jest.fn(),
    } as unknown as Response & { cookie: jest.Mock; clearCookie: jest.Mock };
  }

  it('login: refresh vai para o cookie HttpOnly e some do corpo', async () => {
    const auth = { login: jest.fn().mockResolvedValue(sessao) } as unknown as AuthService;
    const controller = new AuthController(auth);
    const res = montarRes();

    const corpo = await controller.login(
      { email: 'a@b.com', password: 'senha' } as never,
      res,
    );

    expect(corpo).toEqual({
      token: 'id-token',
      expiresIn: 3600,
      uid: 'uid1',
      email: 'a@b.com',
    });
    expect(corpo).not.toHaveProperty('refreshToken');

    const [nome, valor, opcoes] = res.cookie.mock.calls[0];
    expect(nome).toBe(COOKIE_REFRESH);
    expect(valor).toBe('refresh-secreto');
    expect(opcoes).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      path: '/auth',
    });
    // Host-only: `domain` compartilharia o cookie com todo subdominio.
    expect(opcoes.domain).toBeUndefined();
  });

  it('signup: mesma regra do login', async () => {
    const auth = { signup: jest.fn().mockResolvedValue(sessao) } as unknown as AuthService;
    const controller = new AuthController(auth);
    const res = montarRes();

    const corpo = await controller.signup(
      {
        email: 'a@b.com',
        password: 'senha',
        nome: 'Ana',
        aceiteTermos: true,
        aceitePrivacidade: true,
      } as never,
      res,
    );

    expect(corpo).not.toHaveProperty('refreshToken');
    expect(res.cookie).toHaveBeenCalledWith(
      COOKIE_REFRESH,
      'refresh-secreto',
      expect.objectContaining({ httpOnly: true }),
    );
  });

  it('logout: limpa o cookie (o front nao apaga um HttpOnly sozinho)', () => {
    const controller = new AuthController({} as AuthService);
    const res = montarRes();

    expect(controller.logout(res)).toEqual({ ok: true });
    expect(res.clearCookie).toHaveBeenCalledWith(
      COOKIE_REFRESH,
      expect.objectContaining({ httpOnly: true, path: '/auth' }),
    );
  });
});

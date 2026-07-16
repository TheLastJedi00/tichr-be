import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { FirebaseService } from '../firebase/firebase.service';

/**
 * Anti-enumeracao de usuarios.
 *
 * Estes testes existem para travar um comportamento que parece bug e por isso
 * convida a "correcoes": o endpoint responde 200 tanto para e-mail cadastrado
 * quanto para inexistente. Se alguem devolver 404 em `EMAIL_NOT_FOUND`, o
 * endpoint vira um oraculo de quem tem conta no Tichr — e a suite tem que gritar.
 */
describe('AuthService.recuperarSenha — resposta indistinguivel', () => {
  afterEach(() => jest.restoreAllMocks());

  function montar() {
    return new AuthService(
      {} as FirebaseService,
      {
        get: (k: string) =>
          ({
            FIREBASE_WEB_API_KEY: 'fake-key',
            APP_BASE_URL: 'https://tichr.com.br',
          })[k],
      } as unknown as ConfigService,
      {} as JwtService,
    );
  }

  it('e-mail cadastrado: 200 { enviado: true } e dispara PASSWORD_RESET', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => ({ email: 'a@b.com' }),
      });
    global.fetch = fetchMock as never;

    await expect(montar().recuperarSenha('a@b.com')).resolves.toEqual({
      enviado: true,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('accounts:sendOobCode');
    expect(JSON.parse(init.body as string)).toMatchObject({
      requestType: 'PASSWORD_RESET',
      email: 'a@b.com',
    });
  });

  it('e-mail INEXISTENTE: mesma resposta, byte a byte', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: 'EMAIL_NOT_FOUND' } }),
    }) as never;

    const resposta = await montar().recuperarSenha('naoexiste@b.com');

    expect(resposta).toEqual({ enviado: true });
    expect(JSON.stringify(resposta)).toBe(JSON.stringify({ enviado: true }));
  });

  it('provedor fora do ar: ainda assim 200 (status code nao pode vazar estado)', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('ECONNRESET')) as never;

    await expect(montar().recuperarSenha('a@b.com')).resolves.toEqual({
      enviado: true,
    });
  });

  it('falha do provedor e REGISTRADA, mesmo sem mudar a resposta', async () => {
    // Regressao real: o UNAUTHORIZED_DOMAIN (dominio fora dos authorized domains
    // do Firebase) passou despercebido em producao porque o catch calava os dois
    // lados — a API dizia "enviado" e nenhum e-mail saia, sem rastro. A
    // anti-enumeracao e sobre o que o CLIENTE ve, nao sobre cegar a operacao.
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({
        error: {
          message: 'UNAUTHORIZED_DOMAIN : Domain not allowlisted by project',
        },
      }),
    }) as never;
    const service = montar();
    const logErro = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    await expect(service.recuperarSenha('a@b.com')).resolves.toEqual({
      enviado: true,
    });

    expect(logErro).toHaveBeenCalledWith(
      expect.stringContaining('UNAUTHORIZED_DOMAIN'),
    );
  });

  it('e-mail inexistente e warn, nao error (nao e problema nosso)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: 'EMAIL_NOT_FOUND' } }),
    }) as never;
    const service = montar();
    const logErro = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const logWarn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    await service.recuperarSenha('naoexiste@b.com');

    expect(logWarn).toHaveBeenCalled();
    expect(logErro).not.toHaveBeenCalled();
    // E o log NAO repete o e-mail: nao vale trocar enumeracao por HTTP por
    // enumeracao por log.
    expect(logWarn.mock.calls[0][0]).not.toContain('naoexiste@b.com');
  });

  it('cadastrado e inexistente produzem exatamente o mesmo retorno', async () => {
    const service = montar();

    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({}) }) as never;
    const existe = await service.recuperarSenha('a@b.com');

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: 'EMAIL_NOT_FOUND' } }),
    }) as never;
    const naoExiste = await service.recuperarSenha('x@b.com');

    expect(existe).toEqual(naoExiste);
  });
});

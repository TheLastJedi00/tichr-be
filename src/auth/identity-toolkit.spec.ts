import { ConflictException, HttpException, UnauthorizedException } from '@nestjs/common';
import {
  comoHttp,
  sendOobCode,
  signInComSenha,
  trocarRefreshToken,
} from './identity-toolkit';

/**
 * O helper e a unica porta para as APIs REST do Firebase, entao o que importa
 * testar e a traducao de erro do provedor -> excecao com `code` estavel, e a
 * normalizacao do snake_case da Secure Token API.
 */
describe('identity-toolkit', () => {
  afterEach(() => jest.restoreAllMocks());

  function mockFetch(ok: boolean, body: unknown) {
    const mock = jest.fn().mockResolvedValue({ ok, json: async () => body });
    global.fetch = mock as unknown as typeof fetch;
    return mock;
  }

  /** Executa `fn` e devolve a excecao HTTP ja traduzida pelo `comoHttp`. */
  async function capturar(fn: () => Promise<unknown>): Promise<HttpException> {
    try {
      await fn().catch(comoHttp);
    } catch (erro) {
      return erro as HttpException;
    }
    throw new Error('esperava excecao, mas a chamada teve sucesso');
  }

  describe('traducao de erro', () => {
    it('EMAIL_EXISTS vira 409 EMAIL_EM_USO', async () => {
      mockFetch(false, { error: { message: 'EMAIL_EXISTS' } });
      const erro = await capturar(() => signInComSenha('k', 'a@b.com', 'senha'));
      expect(erro).toBeInstanceOf(ConflictException);
      expect(erro.getResponse()).toMatchObject({ code: 'EMAIL_EM_USO' });
    });

    it('TOO_MANY_ATTEMPTS_TRY_LATER vira 429 VERIFICACAO_COOLDOWN', async () => {
      mockFetch(false, { error: { message: 'TOO_MANY_ATTEMPTS_TRY_LATER : ...' } });
      const erro = await capturar(() =>
        sendOobCode('k', { requestType: 'VERIFY_EMAIL' }),
      );
      expect(erro.getStatus()).toBe(429);
      expect(erro.getResponse()).toMatchObject({ code: 'VERIFICACAO_COOLDOWN' });
    });

    it('INVALID_REFRESH_TOKEN vira 401 SESSAO_EXPIRADA', async () => {
      mockFetch(false, { error: { message: 'INVALID_REFRESH_TOKEN' } });
      const erro = await capturar(() => trocarRefreshToken('k', 'refresh'));
      expect(erro).toBeInstanceOf(UnauthorizedException);
      expect(erro.getResponse()).toMatchObject({ code: 'SESSAO_EXPIRADA' });
    });

    it('senha errada vira 401 CREDENCIAL_INVALIDA', async () => {
      mockFetch(false, { error: { message: 'INVALID_LOGIN_CREDENTIALS' } });
      const erro = await capturar(() => signInComSenha('k', 'a@b.com', 'errada'));
      expect(erro).toBeInstanceOf(UnauthorizedException);
      expect(erro.getResponse()).toMatchObject({ code: 'CREDENCIAL_INVALIDA' });
    });
  });

  describe('trocarRefreshToken', () => {
    it('normaliza o snake_case da Secure Token API para o formato do resto do codigo', async () => {
      const fetchMock = mockFetch(true, {
        id_token: 'tok-novo',
        refresh_token: 'refresh-novo',
        expires_in: '3600',
        user_id: 'uid1',
      });

      const tokens = await trocarRefreshToken('chave', 'refresh-velho');

      expect(tokens).toEqual({
        token: 'tok-novo',
        refreshToken: 'refresh-novo',
        expiresIn: 3600,
        uid: 'uid1',
        email: '',
      });

      // Host proprio + form-urlencoded: e o que difere do resto do Identity Toolkit.
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('securetoken.googleapis.com');
      expect((init.headers as Record<string, string>)['Content-Type']).toBe(
        'application/x-www-form-urlencoded',
      );
      expect(init.body).toBe(
        'grant_type=refresh_token&refresh_token=refresh-velho',
      );
    });

    it('mantem o refresh atual quando a API nao devolve um novo', async () => {
      mockFetch(true, { id_token: 'tok', expires_in: '3600', user_id: 'uid1' });
      const tokens = await trocarRefreshToken('chave', 'refresh-velho');
      expect(tokens.refreshToken).toBe('refresh-velho');
    });
  });
});

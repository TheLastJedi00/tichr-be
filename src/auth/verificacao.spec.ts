import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { FirebaseService } from '../firebase/firebase.service';

/** Envio e status da confirmacao de e-mail. */
describe('AuthService — verificacao de e-mail', () => {
  afterEach(() => jest.restoreAllMocks());

  function montar(getUser?: jest.Mock) {
    const firebase = {
      auth: { getUser },
      firestore: { collection: () => ({ doc: () => ({ set: jest.fn() }) }) },
    } as unknown as FirebaseService;
    const config = {
      get: (k: string) =>
        ({
          FIREBASE_WEB_API_KEY: 'fake-key',
          APP_BASE_URL: 'https://tichr.com.br',
        })[k],
    } as unknown as ConfigService;
    return new AuthService(firebase, config, {} as JwtService);
  }

  describe('enviarVerificacao', () => {
    it('dispara VERIFY_EMAIL com o idToken e o continueUrl de volta ao app', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValue({ ok: true, json: async () => ({}) });
      global.fetch = fetchMock as never;

      await expect(montar().enviarVerificacao('id-token')).resolves.toEqual({
        enviado: true,
      });

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('accounts:sendOobCode');
      expect(JSON.parse(init.body as string)).toEqual({
        requestType: 'VERIFY_EMAIL',
        idToken: 'id-token',
        continueUrl: 'https://tichr.com.br/login',
      });
    });
  });

  describe('statusVerificacao', () => {
    it('le ao vivo do Firebase Auth (o claim do token fica congelado)', async () => {
      const getUser = jest.fn().mockResolvedValue({ emailVerified: true });
      await expect(montar(getUser).statusVerificacao('uid1')).resolves.toEqual({
        verificado: true,
      });
      expect(getUser).toHaveBeenCalledWith('uid1');
    });

    it('reflete o nao verificado', async () => {
      const getUser = jest.fn().mockResolvedValue({ emailVerified: false });
      await expect(montar(getUser).statusVerificacao('uid1')).resolves.toEqual({
        verificado: false,
      });
    });
  });

  describe('signup dispara a verificacao', () => {
    it('envia o VERIFY_EMAIL depois de provisionar o perfil', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          idToken: 'tok',
          refreshToken: 'r',
          expiresIn: '3600',
          localId: 'uid1',
          email: 'a@b.com',
        }),
      });
      global.fetch = fetchMock as never;

      await montar().signup('a@b.com', 'segredo', 'Ana', true, true);

      // 1a chamada: signUp. 2a: sendOobCode do VERIFY_EMAIL.
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(url).toContain('accounts:sendOobCode');
      expect(JSON.parse(init.body as string)).toMatchObject({
        requestType: 'VERIFY_EMAIL',
      });
    });

    it('falha no envio NAO derruba o cadastro (a conta ja existe)', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            idToken: 'tok',
            refreshToken: 'r',
            expiresIn: '3600',
            localId: 'uid1',
            email: 'a@b.com',
          }),
        })
        .mockResolvedValueOnce({
          ok: false,
          json: async () => ({ error: { message: 'TOO_MANY_ATTEMPTS_TRY_LATER' } }),
        });
      global.fetch = fetchMock as never;

      const res = await montar().signup('a@b.com', 'segredo', 'Ana', true, true);

      expect(res.token).toBe('tok');
      expect(res.uid).toBe('uid1');
    });
  });
});

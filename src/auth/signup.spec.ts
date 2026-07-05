import { BadRequestException, ConflictException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { FirebaseService } from '../firebase/firebase.service';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

/** Config falso que responde apenas as chaves informadas. */
function fakeConfig(vals: Record<string, string | undefined>): ConfigService {
  return { get: (k: string) => vals[k] } as unknown as ConfigService;
}

describe('AuthService — cadastro e admin', () => {
  afterEach(() => jest.restoreAllMocks());

  function mockFetch(ok: boolean, body: unknown) {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok, json: async () => body }) as unknown as typeof fetch;
  }

  describe('signup (frictionless)', () => {
    let service: AuthService;
    let setDoc: jest.Mock;

    beforeEach(() => {
      setDoc = jest.fn().mockResolvedValue(undefined);
      const firebase = {
        firestore: { collection: () => ({ doc: () => ({ set: setDoc }) }) },
      } as unknown as FirebaseService;
      service = new AuthService(
        firebase,
        fakeConfig({ FIREBASE_WEB_API_KEY: 'fake-key' }),
        {} as JwtService,
      );
    });

    it('cria a conta, provisiona o professor ESTAGIARIO e devolve o token', async () => {
      mockFetch(true, {
        idToken: 'tok',
        refreshToken: 'r',
        expiresIn: '3600',
        localId: 'uid1',
        email: 'a@b.com',
      });

      const res = await service.signup('a@b.com', 'segredo');

      expect(res.token).toBe('tok');
      expect(res.uid).toBe('uid1');
      expect(setDoc).toHaveBeenCalledWith(
        { planoAtual: 'ESTAGIARIO', slotsAdicionaisComprados: 0 },
        { merge: true },
      );
    });

    it('rejeita e-mail ja cadastrado (ConflictException) sem criar doc', async () => {
      mockFetch(false, { error: { message: 'EMAIL_EXISTS' } });

      await expect(service.signup('a@b.com', 'segredo')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(setDoc).not.toHaveBeenCalled();
    });

    it('rejeita senha fraca (BadRequestException)', async () => {
      mockFetch(false, {
        error: { message: 'WEAK_PASSWORD : Password should be at least 6 characters' },
      });

      await expect(service.signup('a@b.com', '123')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('isAdminEmail (bootstrap ADMIN_EMAILS)', () => {
    it('reconhece e-mails da lista (case-insensitive) e ignora o resto', () => {
      const svc = new AuthService(
        {} as FirebaseService,
        fakeConfig({ ADMIN_EMAILS: 'boss@tichr.com, dev@tichr.com' }),
        {} as JwtService,
      );
      expect(svc.isAdminEmail('BOSS@tichr.com')).toBe(true);
      expect(svc.isAdminEmail('rando@x.com')).toBe(false);
      expect(svc.isAdminEmail(undefined)).toBe(false);
    });
  });
});

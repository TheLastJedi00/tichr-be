import { BadRequestException, ConflictException } from '@nestjs/common';
import { AuthService, VERSAO_DOCUMENTOS_LEGAIS } from './auth.service';
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

    it('cria a conta com nome + consentimento, provisiona ESTAGIARIO e devolve o token', async () => {
      mockFetch(true, {
        idToken: 'tok',
        refreshToken: 'r',
        expiresIn: '3600',
        localId: 'uid1',
        email: 'a@b.com',
      });

      const res = await service.signup('a@b.com', 'segredo', '  Ana  ', true, true);

      expect(res.token).toBe('tok');
      expect(res.uid).toBe('uid1');
      expect(setDoc).toHaveBeenCalledWith(
        expect.objectContaining({
          nomeExibicao: 'Ana', // trim aplicado
          planoAtual: 'ESTAGIARIO',
          slotsAdicionaisComprados: 0,
          versaoDocumentosLegais: VERSAO_DOCUMENTOS_LEGAIS,
        }),
        { merge: true },
      );
      const gravado = setDoc.mock.calls[0][0];
      expect(typeof gravado.aceiteTermosEm).toBe('string');
      expect(typeof gravado.aceitePrivacidadeEm).toBe('string');
    });

    it('grava planoPretendido quando o plano escolhido e pago', async () => {
      mockFetch(true, { idToken: 'tok', refreshToken: 'r', expiresIn: '3600', localId: 'uid1', email: 'a@b.com' });
      await service.signup('a@b.com', 'segredo', 'Ana', true, true, 'MESTRE');
      expect(setDoc).toHaveBeenCalledWith(
        expect.objectContaining({ planoPretendido: 'MESTRE' }),
        { merge: true },
      );
    });

    it('NAO grava planoPretendido para ESTAGIARIO (gratuito)', async () => {
      mockFetch(true, { idToken: 'tok', refreshToken: 'r', expiresIn: '3600', localId: 'uid1', email: 'a@b.com' });
      await service.signup('a@b.com', 'segredo', 'Ana', true, true, 'ESTAGIARIO');
      expect(setDoc.mock.calls[0][0]).not.toHaveProperty('planoPretendido');
    });

    it('rejeita sem aceite dos termos, antes de tocar a rede', async () => {
      const fetchMock = jest.fn();
      (global as unknown as { fetch: unknown }).fetch = fetchMock;
      await expect(
        service.signup('a@b.com', 'segredo', 'Ana', false, true),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.signup('a@b.com', 'segredo', 'Ana', true, false),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(setDoc).not.toHaveBeenCalled();
    });

    it('rejeita e-mail ja cadastrado (ConflictException) sem criar doc', async () => {
      mockFetch(false, { error: { message: 'EMAIL_EXISTS' } });

      await expect(
        service.signup('a@b.com', 'segredo', 'Ana', true, true),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(setDoc).not.toHaveBeenCalled();
    });

    it('rejeita senha fraca (BadRequestException)', async () => {
      mockFetch(false, {
        error: { message: 'WEAK_PASSWORD : Password should be at least 6 characters' },
      });

      await expect(
        service.signup('a@b.com', '123', 'Ana', true, true),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});

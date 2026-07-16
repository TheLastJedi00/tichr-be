import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { FirebaseService } from '../firebase/firebase.service';

/** Troca de e-mail: reautentica, depois pede a confirmacao na caixa NOVA. */
describe('AuthService.trocarEmail', () => {
  afterEach(() => jest.restoreAllMocks());

  function montar(email: string | undefined = 'atual@b.com') {
    const setDoc = jest.fn();
    const firebase = {
      auth: { getUser: jest.fn().mockResolvedValue({ email, emailVerified: true }) },
      firestore: { collection: () => ({ doc: () => ({ set: setDoc }) }) },
    } as unknown as FirebaseService;
    const config = {
      get: (k: string) =>
        ({
          FIREBASE_WEB_API_KEY: 'fake-key',
          APP_BASE_URL: 'https://tichr.com.br',
        })[k],
    } as unknown as ConfigService;
    return {
      service: new AuthService(firebase, config, {} as JwtService),
      setDoc,
    };
  }

  it('usa VERIFY_AND_CHANGE_EMAIL: o e-mail so troca no clique da caixa nova', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({}) });
    global.fetch = fetchMock as never;
    const { service } = montar();

    const res = await service.trocarEmail('uid1', 'id-token', 'novo@b.com', 'senha');

    expect(res).toEqual({ enviado: true, novoEmail: 'novo@b.com' });

    // 1a chamada: reautenticacao. 2a: o oob da troca.
    const [, initOob] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(initOob.body as string)).toEqual({
      requestType: 'VERIFY_AND_CHANGE_EMAIL',
      idToken: 'id-token',
      newEmail: 'novo@b.com',
      continueUrl: 'https://tichr.com.br/login',
    });
  });

  it('senha errada: 401 SENHA_INVALIDA e NAO dispara o e-mail', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: 'INVALID_LOGIN_CREDENTIALS' } }),
    });
    global.fetch = fetchMock as never;
    const { service } = montar();

    const erro = await service
      .trocarEmail('uid1', 'id-token', 'novo@b.com', 'errada')
      .catch((e: UnauthorizedException) => e);

    expect(erro).toBeInstanceOf(UnauthorizedException);
    expect((erro as UnauthorizedException).getResponse()).toMatchObject({
      code: 'SENHA_INVALIDA',
    });
    // So a reautenticacao foi tentada: nenhum e-mail saiu.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('e-mail ja em uso: 409 EMAIL_EM_USO', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: { message: 'EMAIL_EXISTS' } }),
      }) as never;
    const { service } = montar();

    const erro = await service
      .trocarEmail('uid1', 'id-token', 'ocupado@b.com', 'senha')
      .catch((e: Error) => e);

    expect((erro as UnauthorizedException).getResponse()).toMatchObject({
      code: 'EMAIL_EM_USO',
    });
  });

  it('nao grava e-mail no Firestore (ele vive so no Auth)', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({}) }) as never;
    const { service, setDoc } = montar();

    await service.trocarEmail('uid1', 'id-token', 'novo@b.com', 'senha');

    expect(setDoc).not.toHaveBeenCalled();
  });
});

describe('AuthService.conta', () => {
  it('devolve o e-mail atual e o status de verificacao', async () => {
    const firebase = {
      auth: {
        getUser: jest
          .fn()
          .mockResolvedValue({ email: 'a@b.com', emailVerified: false }),
      },
    } as unknown as FirebaseService;
    const service = new AuthService(
      firebase,
      { get: () => 'k' } as unknown as ConfigService,
      {} as JwtService,
    );

    await expect(service.conta('uid1')).resolves.toEqual({
      email: 'a@b.com',
      emailVerificado: false,
    });
  });
});

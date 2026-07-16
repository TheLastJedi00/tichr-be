import { UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { FirebaseService } from '../firebase/firebase.service';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { COOKIE_REFRESH } from './sessao.cookie';

/** Renovacao de sessao: o refresh vem do cookie e nunca do corpo. */
describe('AuthService.refresh', () => {
  afterEach(() => jest.restoreAllMocks());

  function montar() {
    return new AuthService(
      {} as FirebaseService,
      { get: () => 'fake-key' } as unknown as ConfigService,
      {} as JwtService,
    );
  }

  it('devolve uma sessao nova a partir do refresh', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id_token: 'tok-novo',
        refresh_token: 'refresh-novo',
        expires_in: '3600',
        user_id: 'uid1',
      }),
    }) as never;

    const sessao = await montar().refresh('refresh-velho');

    expect(sessao.token).toBe('tok-novo');
    expect(sessao.refreshToken).toBe('refresh-novo');
  });

  it('sem cookie: 401 SESSAO_EXPIRADA, sem tocar a rede', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as never;

    const erro = await montar()
      .refresh('')
      .catch((e: UnauthorizedException) => e);

    expect(erro).toBeInstanceOf(UnauthorizedException);
    expect((erro as UnauthorizedException).getResponse()).toMatchObject({
      code: 'SESSAO_EXPIRADA',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refresh revogado (troca de senha/e-mail): 401 SESSAO_EXPIRADA', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: 'TOKEN_EXPIRED' } }),
    }) as never;

    const erro = await montar()
      .refresh('revogado')
      .catch((e: UnauthorizedException) => e);

    expect(erro).toBeInstanceOf(UnauthorizedException);
    expect((erro as UnauthorizedException).getResponse()).toMatchObject({
      code: 'SESSAO_EXPIRADA',
    });
  });
});

describe('AuthController.refresh', () => {
  it('le o refresh do cookie, rotaciona e nao o devolve no corpo', async () => {
    const auth = {
      refresh: jest.fn().mockResolvedValue({
        token: 'tok-novo',
        refreshToken: 'refresh-rotacionado',
        expiresIn: 3600,
        uid: 'uid1',
        email: 'a@b.com',
      }),
    } as unknown as AuthService;
    const controller = new AuthController(auth);
    const req = { cookies: { [COOKIE_REFRESH]: 'refresh-velho' } } as unknown as Request;
    const res = { cookie: jest.fn() } as unknown as Response & { cookie: jest.Mock };

    const corpo = await controller.refresh(req, res);

    expect(auth.refresh).toHaveBeenCalledWith('refresh-velho');
    expect(corpo).not.toHaveProperty('refreshToken');
    expect(corpo.token).toBe('tok-novo');
    // Rotacionou: o cookie precisa acompanhar, senao a proxima renovacao morre.
    expect(res.cookie).toHaveBeenCalledWith(
      COOKIE_REFRESH,
      'refresh-rotacionado',
      expect.objectContaining({ httpOnly: true }),
    );
  });

  it('sem cookie nenhum: repassa string vazia (o service decide o 401)', async () => {
    const auth = {
      refresh: jest.fn().mockRejectedValue(new UnauthorizedException()),
    } as unknown as AuthService;
    const controller = new AuthController(auth);
    const req = { cookies: {} } as unknown as Request;
    const res = { cookie: jest.fn() } as unknown as Response;

    await expect(controller.refresh(req, res)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(auth.refresh).toHaveBeenCalledWith('');
  });
});

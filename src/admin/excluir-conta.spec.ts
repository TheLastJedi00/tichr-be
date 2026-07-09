import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { AdminService } from './admin.service';

/**
 * Auto-exclusão da conta: confirma a senha (reautenticação) antes do hard delete.
 * Mocka o Identity Toolkit (fetch) e o Firebase Auth; espiona `excluirUsuario`
 * para não exercitar o cascade de dados aqui.
 */
describe('AdminService.excluirPropriaConta', () => {
  function montar(email: string | undefined) {
    const firebase = {
      auth: { getUser: jest.fn().mockResolvedValue({ email }) },
    } as never;
    const config = { get: jest.fn().mockReturnValue('fake-key') } as never;
    const service = new AdminService(firebase, config);
    const hard = jest
      .spyOn(service, 'excluirUsuario')
      .mockResolvedValue({ modo: 'hard' });
    return { service, hard };
  }

  afterEach(() => jest.restoreAllMocks());

  it('senha correta: reautentica e faz o hard delete da propria conta', async () => {
    const { service, hard } = montar('a@b.com');
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as never;

    const res = await service.excluirPropriaConta('uid1', 'certa');

    expect(res).toEqual({ modo: 'hard' });
    expect(hard).toHaveBeenCalledWith('uid1', true);
  });

  it('senha incorreta: 401 e NAO exclui', async () => {
    const { service, hard } = montar('a@b.com');
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, json: async () => ({ error: {} }) }) as never;

    await expect(
      service.excluirPropriaConta('uid1', 'errada'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(hard).not.toHaveBeenCalled();
  });

  it('conta sem e-mail: BadRequest', async () => {
    const { service, hard } = montar(undefined);
    await expect(
      service.excluirPropriaConta('uid1', 'x'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(hard).not.toHaveBeenCalled();
  });
});

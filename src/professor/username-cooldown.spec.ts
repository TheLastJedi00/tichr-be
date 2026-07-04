import { ConflictException } from '@nestjs/common';
import { ProfessorEntity } from './entities/professor.entity';
import { ProfessorService } from './professor.service';
import { ProfessorRepository } from './professor.repository';

/** Um instante ISO a `dias` dias atras de agora. */
function haDias(dias: number): string {
  return new Date(Date.now() - dias * 86_400_000).toISOString();
}

describe('Trava de @username (cooldown de 60 dias)', () => {
  describe('ProfessorEntity.diasParaTrocarUsername', () => {
    it('libera quando o username nunca foi trocado', () => {
      const p = new ProfessorEntity({ uid: 'u1' });
      expect(p.diasParaTrocarUsername()).toBe(0);
      expect(p.podeAlterarUsername()).toBe(true);
    });

    it('bloqueia logo apos uma troca (~60 dias restantes)', () => {
      const p = new ProfessorEntity({ uid: 'u1', lastUsernameChange: haDias(1) });
      expect(p.diasParaTrocarUsername()).toBeGreaterThan(0);
      expect(p.diasParaTrocarUsername()).toBeLessThanOrEqual(60);
      expect(p.podeAlterarUsername()).toBe(false);
    });

    it('libera depois de passados 60 dias', () => {
      const p = new ProfessorEntity({ uid: 'u1', lastUsernameChange: haDias(61) });
      expect(p.diasParaTrocarUsername()).toBe(0);
      expect(p.podeAlterarUsername()).toBe(true);
    });
  });

  describe('ProfessorService.updateProfile', () => {
    let repo: jest.Mocked<Pick<ProfessorRepository, 'findByUid' | 'findByUsername' | 'upsert'>>;
    let service: ProfessorService;

    beforeEach(() => {
      repo = {
        findByUid: jest.fn(),
        findByUsername: jest.fn(),
        upsert: jest.fn(),
      };
      service = new ProfessorService(repo as unknown as ProfessorRepository);
    });

    it('permite a primeira definicao do username e grava lastUsernameChange', async () => {
      repo.findByUid.mockResolvedValue(new ProfessorEntity({ uid: 'u1' }));
      repo.findByUsername.mockResolvedValue(null);
      repo.upsert.mockImplementation(async (uid, data) =>
        new ProfessorEntity({ uid, ...data }),
      );

      await service.updateProfile('u1', { username: 'prof.marina' });

      const [, data] = repo.upsert.mock.calls[0];
      expect(data.username).toBe('prof.marina');
      expect(typeof data.lastUsernameChange).toBe('string');
    });

    it('bloqueia a troca dentro do cooldown com code USERNAME_COOLDOWN', async () => {
      repo.findByUid.mockResolvedValue(
        new ProfessorEntity({
          uid: 'u1',
          username: 'prof.marina',
          lastUsernameChange: haDias(10),
        }),
      );

      await expect(
        service.updateProfile('u1', { username: 'prof.nova' }),
      ).rejects.toMatchObject({
        response: { code: 'USERNAME_COOLDOWN' },
      });
      expect(repo.upsert).not.toHaveBeenCalled();
    });

    it('permite salvar outros campos mantendo o mesmo username no cooldown', async () => {
      repo.findByUid.mockResolvedValue(
        new ProfessorEntity({
          uid: 'u1',
          username: 'prof.marina',
          lastUsernameChange: haDias(10),
        }),
      );
      repo.upsert.mockImplementation(async (uid, data) =>
        new ProfessorEntity({ uid, ...data }),
      );

      await service.updateProfile('u1', {
        username: 'prof.marina',
        bio: 'nova bio',
      });

      const [, data] = repo.upsert.mock.calls[0];
      expect(data.bio).toBe('nova bio');
      // Nao reinicia o relogio quando o handle nao muda.
      expect(data.lastUsernameChange).toBeUndefined();
    });

    it('libera a troca apos 60 dias', async () => {
      repo.findByUid.mockResolvedValue(
        new ProfessorEntity({
          uid: 'u1',
          username: 'prof.marina',
          lastUsernameChange: haDias(61),
        }),
      );
      repo.findByUsername.mockResolvedValue(null);
      repo.upsert.mockImplementation(async (uid, data) =>
        new ProfessorEntity({ uid, ...data }),
      );

      await service.updateProfile('u1', { username: 'prof.nova' });

      const [, data] = repo.upsert.mock.calls[0];
      expect(data.username).toBe('prof.nova');
      expect(typeof data.lastUsernameChange).toBe('string');
    });

    it('rejeita username ja usado por outro professor', async () => {
      repo.findByUid.mockResolvedValue(new ProfessorEntity({ uid: 'u1' }));
      repo.findByUsername.mockResolvedValue(new ProfessorEntity({ uid: 'outro' }));

      await expect(
        service.updateProfile('u1', { username: 'prof.marina' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});

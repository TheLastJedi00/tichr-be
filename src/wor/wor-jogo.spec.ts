import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { WorJogoService } from './wor-jogo.service';
import { WorJogoRepository } from './wor-jogo.repository';
import { WorJogoEntity } from './entities/wor-jogo.entity';

describe('WorJogoService (arsenal)', () => {
  describe('normalizarPalavras', () => {
    it('apara textos, gera ids e limita as dicas a 3', () => {
      const r = WorJogoService.normalizarPalavras([
        { palavra: '  guilhotina ', dicas: [' a ', 'b', '', 'c', 'd'] },
      ]);
      expect(r).toHaveLength(1);
      expect(r[0].palavra).toBe('guilhotina');
      expect(r[0].dicas).toEqual(['a', 'b', 'c']);
      expect(typeof r[0].id).toBe('string');
      expect(r[0].id.length).toBeGreaterThan(0);
    });

    it('aceita palavra sem dicas', () => {
      const r = WorJogoService.normalizarPalavras([{ palavra: 'rei' }]);
      expect(r[0].dicas).toEqual([]);
    });
  });

  describe('posse (obter)', () => {
    let repo: jest.Mocked<Pick<WorJogoRepository, 'findById'>>;
    let service: WorJogoService;

    beforeEach(() => {
      repo = { findById: jest.fn() };
      service = new WorJogoService(repo as unknown as WorJogoRepository);
    });

    it('404 quando não existe', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.obter('u1', 'x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('403 quando é de outro professor', async () => {
      repo.findById.mockResolvedValue(
        new WorJogoEntity({ id: 'x', professorId: 'outro' }),
      );
      await expect(service.obter('u1', 'x')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('devolve quando é do próprio professor', async () => {
      const jogo = new WorJogoEntity({ id: 'x', professorId: 'u1' });
      repo.findById.mockResolvedValue(jogo);
      await expect(service.obter('u1', 'x')).resolves.toBe(jogo);
    });
  });
});

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ProfessorEntity } from '../professor/entities/professor.entity';
import { WorJogoService } from './wor-jogo.service';
import { WorJogoRepository } from './wor-jogo.repository';
import { WorJogoEntity } from './entities/wor-jogo.entity';

const professorFake = (plano: 'PHD' | 'MESTRE' = 'PHD') =>
  ({
    getProfile: jest
      .fn()
      .mockResolvedValue(new ProfessorEntity({ planoAtual: plano })),
  }) as never;

const turmaServiceFake = () =>
  ({ buscarTurma: jest.fn().mockResolvedValue({ id: 't1' }) }) as never;

const dtoValido = () => ({
  nome: 'Revisão de História',
  palavras: [{ palavra: 'guilhotina', dicas: ['a', 'b'] }],
});

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

  describe('exclusividade PhD (padrão do ecossistema)', () => {
    it('bloqueia criação para não-PhD (403 WOR_LOCKED)', async () => {
      const service = new WorJogoService(
        {} as never,
        professorFake('MESTRE'),
        turmaServiceFake(),
      );
      await expect(service.criar('u1', dtoValido())).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('vínculo de turma (N:N) espelha o Qlick', () => {
    it('valida posse de cada turma e persiste turmaIds + turmaId legado', async () => {
      const repo = {
        create: jest
          .fn()
          .mockImplementation(async (j) => new WorJogoEntity({ ...(j as object), id: 'w1' })),
      };
      const turmaService = { buscarTurma: jest.fn().mockResolvedValue({ id: 't' }) };
      const service = new WorJogoService(
        repo as never,
        professorFake('PHD'),
        turmaService as never,
      );

      const jogo = await service.criar('p1', {
        ...dtoValido(),
        turmaIds: ['t1', 't2'],
        topicoId: 'top1',
      });

      expect(turmaService.buscarTurma).toHaveBeenCalledTimes(2);
      expect(jogo.turmaIds).toEqual(['t1', 't2']);
      expect(jogo.turmaId).toBe('t1');
      expect(jogo.topicoId).toBe('top1');
    });

    it('getter turmas une turmaIds (N:N) + legado turmaId', () => {
      expect(new WorJogoEntity({ turmaIds: ['a'], turmaId: 'b' }).turmas).toEqual(['a', 'b']);
      expect(new WorJogoEntity({ turmaId: 'b' }).turmas).toEqual(['b']);
      expect(new WorJogoEntity({ turmaIds: ['a', 'b'] }).turmas).toEqual(['a', 'b']);
    });
  });

  describe('posse (obter)', () => {
    let repo: jest.Mocked<Pick<WorJogoRepository, 'findById'>>;
    let service: WorJogoService;

    beforeEach(() => {
      repo = { findById: jest.fn() };
      service = new WorJogoService(
        repo as unknown as WorJogoRepository,
        professorFake('PHD'),
        turmaServiceFake(),
      );
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

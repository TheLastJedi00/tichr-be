import { BadRequestException } from '@nestjs/common';
import { AlunoService } from './aluno.service';
import { TurmaService } from './turma.service';
import { AlunoEntity } from './entities/aluno.entity';
import { TurmaEntity } from './entities/turma.entity';

describe('Hall da Fama — encerramento e read-only', () => {
  describe('TurmaService.encerrar', () => {
    it('marca encerradaManualmente e persiste', async () => {
      const turma = new TurmaEntity({
        id: 't1',
        professorId: 'p1',
        pinTurma: '07',
        tipoModalidade: 'GRADE_FIXA',
      });
      const turmaRepo = {
        findById: jest.fn().mockResolvedValue(turma),
        update: jest.fn().mockResolvedValue(undefined),
      };
      const service = new TurmaService(
        turmaRepo as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );

      const res = await service.encerrar('p1', 't1');

      expect(res.encerradaManualmente).toBe(true);
      expect(turmaRepo.update).toHaveBeenCalledWith('t1', {
        encerradaManualmente: true,
      });
    });
  });

  describe('AlunoService.adicionar (turma encerrada = read-only)', () => {
    it('recusa adicionar alunos em turma encerrada', async () => {
      const turmaRepo = {
        findById: jest.fn().mockResolvedValue(
          new TurmaEntity({
            id: 't1',
            professorId: 'p1',
            encerradaManualmente: true,
            tipoModalidade: 'GRADE_FIXA',
          }),
        ),
      };
      const alunoRepo = { findByTurma: jest.fn(), create: jest.fn() };
      const service = new AlunoService(
        alunoRepo as never,
        turmaRepo as never,
        {} as never,
        {} as never,
        {} as never,
      );

      await expect(
        service.adicionar('p1', 't1', ['Ana']),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(alunoRepo.create).not.toHaveBeenCalled();
    });

    it('permite adicionar em turma ativa', async () => {
      const turmaRepo = {
        findById: jest.fn().mockResolvedValue(
          new TurmaEntity({ id: 't1', professorId: 'p1', tipoModalidade: 'GRADE_FIXA' }),
        ),
      };
      const alunoRepo = {
        findByTurma: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(async (a: AlunoEntity) => a),
      };
      const service = new AlunoService(
        alunoRepo as never,
        turmaRepo as never,
        {} as never,
        {} as never,
        {} as never,
      );

      const alunos = await service.adicionar('p1', 't1', ['Ana']);
      expect(alunos[0].pinAcesso).toBe('01');
    });
  });
});

import { ForbiddenException } from '@nestjs/common';
import { AlunoService } from './aluno.service';
import { AlunoEntity } from './entities/aluno.entity';
import { ProfessorEntity } from '../professor/entities/professor.entity';
import { PlanoAtual } from '../professor/entities/professor.entity';

/**
 * Gate de plano no cadastro de alunos (spec 011): a gestao nominal de alunos
 * (adicionar/renomear) exige o plano Mestre ou superior. Estagiario e Graduado
 * recebem 403 PLANO_LOCKED.
 */
describe('AlunoService — gate de cadastro (Mestre+)', () => {
  const PROF = 'p1';
  const TURMA = 't1';

  const montar = (plano: PlanoAtual) => {
    const alunoRepo = {
      findById: jest
        .fn()
        .mockResolvedValue(
          new AlunoEntity({ id: 'a1', turmaId: TURMA, nome: 'Ana' }),
        ),
      findByTurma: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue(undefined),
      create: jest.fn((a: AlunoEntity) => Promise.resolve(a)),
    };
    const turmaRepo = {
      findById: jest
        .fn()
        .mockResolvedValue({ id: TURMA, professorId: PROF, encerradaManualmente: false }),
    };
    const professorService = {
      getProfile: jest
        .fn()
        .mockResolvedValue(new ProfessorEntity({ uid: PROF, planoAtual: plano })),
    };
    const service = new AlunoService(
      alunoRepo as never,
      turmaRepo as never,
      {} as never,
      {} as never,
      {} as never,
      professorService as never,
    );
    return { service, alunoRepo };
  };

  it.each<PlanoAtual>(['ESTAGIARIO', 'GRADUADO'])(
    'recusa adicionar alunos no plano %s (403 PLANO_LOCKED)',
    async (plano) => {
      const { service, alunoRepo } = montar(plano);
      await expect(service.adicionar(PROF, TURMA, ['Ana'])).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(alunoRepo.create).not.toHaveBeenCalled();
    },
  );

  it.each<PlanoAtual>(['ESTAGIARIO', 'GRADUADO'])(
    'recusa renomear aluno no plano %s',
    async (plano) => {
      const { service } = montar(plano);
      await expect(
        service.renomear(PROF, TURMA, 'a1', 'Ana Maria'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    },
  );

  it.each<PlanoAtual>(['MESTRE', 'PHD'])(
    'permite adicionar alunos no plano %s',
    async (plano) => {
      const { service, alunoRepo } = montar(plano);
      const criados = await service.adicionar(PROF, TURMA, ['Ana']);
      expect(criados).toHaveLength(1);
      expect(alunoRepo.create).toHaveBeenCalledTimes(1);
    },
  );

  it('permite renomear no plano Mestre', async () => {
    const { service } = montar('MESTRE');
    const res = await service.renomear(PROF, TURMA, 'a1', '  Ana Maria  ');
    expect(res.nome).toBe('Ana Maria');
  });
});

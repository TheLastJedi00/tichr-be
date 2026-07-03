import { NotFoundException } from '@nestjs/common';
import { AlunoService } from './aluno.service';
import { AlunoEntity } from './entities/aluno.entity';

/** Renomear aluno: valida posse da turma e do aluno. */
describe('AlunoService.renomear', () => {
  const PROF = 'p1';
  const TURMA = 't1';

  const montar = (turmaProf = PROF, aluno?: AlunoEntity) => {
    const alunoRepo = {
      findById: jest.fn().mockResolvedValue(aluno ?? null),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const turmaRepo = {
      findById: jest.fn().mockResolvedValue({ id: TURMA, professorId: turmaProf }),
    };
    const service = new AlunoService(
      alunoRepo as never,
      turmaRepo as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, alunoRepo };
  };

  it('renomeia (com trim) quando aluno pertence a turma do professor', async () => {
    const { service, alunoRepo } = montar(
      PROF,
      new AlunoEntity({ id: 'a1', turmaId: TURMA, nome: 'Ana' }),
    );
    const res = await service.renomear(PROF, TURMA, 'a1', '  Ana Maria  ');
    expect(res.nome).toBe('Ana Maria');
    expect(alunoRepo.update).toHaveBeenCalledWith('a1', { nome: 'Ana Maria' });
  });

  it('recusa turma de outro professor', async () => {
    const { service } = montar('outro');
    await expect(
      service.renomear(PROF, TURMA, 'a1', 'X'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('recusa aluno de outra turma', async () => {
    const { service } = montar(
      PROF,
      new AlunoEntity({ id: 'a1', turmaId: 'outra', nome: 'Ana' }),
    );
    await expect(
      service.renomear(PROF, TURMA, 'a1', 'X'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

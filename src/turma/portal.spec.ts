import { NotFoundException } from '@nestjs/common';
import { ProfessorEntity } from '../professor/entities/professor.entity';
import { ProfessorService } from '../professor/professor.service';
import { TurmaEntity } from './entities/turma.entity';
import { PortalService } from './portal.service';
import { AlunoRepository } from './repositories/aluno.repository';
import { TurmaRepository } from './repositories/turma.repository';

describe('PortalService.turmasAtivas', () => {
  let professorService: { findByUsername: jest.Mock };
  let turmaRepo: { findByProfessor: jest.Mock };
  let service: PortalService;

  beforeEach(() => {
    professorService = { findByUsername: jest.fn() };
    turmaRepo = { findByProfessor: jest.fn() };
    service = new PortalService(
      professorService as unknown as ProfessorService,
      turmaRepo as unknown as TurmaRepository,
      {} as unknown as AlunoRepository,
    );
  });

  it('devolve os dados do professor (com avatar) + so as turmas ativas', async () => {
    professorService.findByUsername.mockResolvedValue(
      new ProfessorEntity({
        uid: 'u1',
        nomeExibicao: 'Prof. Marina',
        username: 'prof.marina',
        avatarUrl: 'https://cdn/foto.png',
      }),
    );
    turmaRepo.findByProfessor.mockResolvedValue([
      new TurmaEntity({ id: 't1', nome: 'Turma A', cor: '#123456', tipoModalidade: 'GRADE_FIXA', pinTurma: '07' }),
      new TurmaEntity({
        id: 't2',
        nome: 'Encerrada',
        tipoModalidade: 'MODULO_FECHADO',
        dataFimPrevista: '2000-01-01',
      }),
    ]);

    const res = await service.turmasAtivas('prof.marina');

    expect(res.professor).toEqual({
      nome: 'Prof. Marina',
      username: 'prof.marina',
      avatarUrl: 'https://cdn/foto.png',
    });
    // Smart PIN de 2 díg → pinLength 2 (informa quantos slots o portal exibe).
    expect(res.turmas).toEqual([
      { turmaId: 't1', nome: 'Turma A', cor: '#123456', pinLength: 2 },
    ]);
  });

  it('404 quando o @username nao existe', async () => {
    professorService.findByUsername.mockResolvedValue(null);
    await expect(service.turmasAtivas('fantasma')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('PortalService — Hall da Fama', () => {
  const montar = () => {
    const professorService = { findByUsername: jest.fn() };
    const turmaRepo = { findByProfessor: jest.fn(), findById: jest.fn() };
    const alunoRepo = { findByTurma: jest.fn() };
    const service = new PortalService(
      professorService as unknown as ProfessorService,
      turmaRepo as unknown as TurmaRepository,
      alunoRepo as unknown as AlunoRepository,
    );
    return { service, professorService, turmaRepo, alunoRepo };
  };

  it('hall() devolve só as turmas encerradas/inativas', async () => {
    const { service, professorService, turmaRepo } = montar();
    professorService.findByUsername.mockResolvedValue(
      new ProfessorEntity({ uid: 'u1', username: 'prof.marina' }),
    );
    turmaRepo.findByProfessor.mockResolvedValue([
      new TurmaEntity({ id: 'ativa', nome: 'Ativa', tipoModalidade: 'GRADE_FIXA' }),
      new TurmaEntity({
        id: 'fim',
        nome: 'Encerrada',
        tipoModalidade: 'GRADE_FIXA',
        encerradaManualmente: true,
      }),
    ]);

    const res = await service.hall('prof.marina');
    expect(res.turmas.map((t) => t.turmaId)).toEqual(['fim']);
  });

  it('hallTurma() devolve ranking por pontuação, sem PIN', async () => {
    const { service, turmaRepo, alunoRepo } = montar();
    turmaRepo.findById.mockResolvedValue(
      new TurmaEntity({
        id: 'fim',
        nome: 'Encerrada',
        tipoModalidade: 'GRADE_FIXA',
        encerradaManualmente: true,
      }),
    );
    alunoRepo.findByTurma.mockResolvedValue([
      { id: 'a1', nome: 'Ana', xpTotal: 50, pinAcesso: '01' },
      { id: 'a2', nome: 'Bruno', xpTotal: 120, pinAcesso: '02' },
    ]);

    const res = await service.hallTurma('fim');
    expect(res.ranking[0]).toMatchObject({ posicao: 1, nome: 'Bruno', xpTotal: 120 });
    expect(res.ranking[1]).toMatchObject({ posicao: 2, nome: 'Ana' });
    expect(JSON.stringify(res)).not.toContain('pinAcesso');
  });

  it('hallTurma() recusa turma ainda ativa (404)', async () => {
    const { service, turmaRepo } = montar();
    turmaRepo.findById.mockResolvedValue(
      new TurmaEntity({ id: 'ativa', nome: 'Ativa', tipoModalidade: 'GRADE_FIXA' }),
    );
    await expect(service.hallTurma('ativa')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

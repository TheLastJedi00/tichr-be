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
      new TurmaEntity({ id: 't1', nome: 'Turma A', cor: '#123456', tipoModalidade: 'GRADE_FIXA' }),
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
    expect(res.turmas).toEqual([{ turmaId: 't1', nome: 'Turma A', cor: '#123456' }]);
  });

  it('404 quando o @username nao existe', async () => {
    professorService.findByUsername.mockResolvedValue(null);
    await expect(service.turmasAtivas('fantasma')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

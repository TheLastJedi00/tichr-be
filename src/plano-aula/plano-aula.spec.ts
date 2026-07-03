import { ForbiddenException } from '@nestjs/common';
import { ProfessorEntity } from '../professor/entities/professor.entity';
import { AlocacaoEntity } from './entities/alocacao.entity';
import { TopicoEntity } from './entities/topico.entity';
import { AlocacaoService } from './alocacao.service';
import { TopicoService } from './topico.service';

const professorFake = (plano: 'ESTAGIARIO' | 'MESTRE' | 'PHD' = 'MESTRE') =>
  ({
    getProfile: jest
      .fn()
      .mockResolvedValue(new ProfessorEntity({ planoAtual: plano })),
  }) as never;

describe('TopicoService', () => {
  it('cadastra em lote sem duplicar (ignora existentes/vazios)', async () => {
    const topicoRepo = {
      findByDisciplina: jest
        .fn()
        .mockResolvedValue([new TopicoEntity({ nome: 'HTML' })]),
      create: jest.fn().mockImplementation(async (t) => t),
    };
    const service = new TopicoService(
      topicoRepo as never,
      {} as never,
      professorFake('MESTRE'),
    );
    const criados = await service.adicionar('p1', 'Web', [
      'HTML',
      'CSS',
      ' CSS ',
      '',
    ]);
    expect(criados.map((t) => t.nome)).toEqual(['CSS']);
  });

  it('bloqueia quando o professor nao e Mestre', async () => {
    const service = new TopicoService(
      {} as never,
      {} as never,
      professorFake('ESTAGIARIO'),
    );
    await expect(service.listar('p1', 'Web')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('ao remover, limpa as alocacoes do topico', async () => {
    const topicoRepo = { delete: jest.fn().mockResolvedValue(undefined) };
    const alocacaoRepo = {
      deleteByTopico: jest.fn().mockResolvedValue(undefined),
    };
    const service = new TopicoService(
      topicoRepo as never,
      alocacaoRepo as never,
      professorFake('MESTRE'),
    );
    await service.remover('p1', 't-html');
    expect(alocacaoRepo.deleteByTopico).toHaveBeenCalledWith('t-html');
    expect(topicoRepo.delete).toHaveBeenCalledWith('t-html');
  });
});

describe('AlocacaoService', () => {
  const turmaService = {
    buscarTurma: jest.fn().mockResolvedValue({ id: 'turma1' }),
  } as never;

  it('cria alocacao nova por (turma, numero)', async () => {
    const alocacaoRepo = {
      findByTurma: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(async (a) => a),
    };
    const service = new AlocacaoService(
      alocacaoRepo as never,
      professorFake('MESTRE'),
      turmaService,
    );
    const res = (await service.definir('p1', 'turma1', 3, 'topX')) as AlocacaoEntity;
    expect(res.numeroAula).toBe(3);
    expect(res.topicoId).toBe('topX');
  });

  it('atualiza a alocacao existente da mesma aula (upsert)', async () => {
    const alocacaoRepo = {
      findByTurma: jest
        .fn()
        .mockResolvedValue([
          new AlocacaoEntity({ id: 'a1', turmaId: 'turma1', numeroAula: 3, topicoId: 'old' }),
        ]),
      update: jest.fn().mockResolvedValue(undefined),
      create: jest.fn(),
    };
    const service = new AlocacaoService(
      alocacaoRepo as never,
      professorFake('MESTRE'),
      turmaService,
    );
    const res = (await service.definir('p1', 'turma1', 3, 'novo')) as AlocacaoEntity;
    expect(res.topicoId).toBe('novo');
    expect(alocacaoRepo.update).toHaveBeenCalledWith('a1', { topicoId: 'novo' });
    expect(alocacaoRepo.create).not.toHaveBeenCalled();
  });

  it('desaloca (null) removendo a alocacao da aula', async () => {
    const alocacaoRepo = {
      findByTurma: jest
        .fn()
        .mockResolvedValue([
          new AlocacaoEntity({ id: 'a1', turmaId: 'turma1', numeroAula: 3, topicoId: 'x' }),
        ]),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const service = new AlocacaoService(
      alocacaoRepo as never,
      professorFake('MESTRE'),
      turmaService,
    );
    const res = await service.definir('p1', 'turma1', 3, null);
    expect(res).toEqual({ removido: true });
    expect(alocacaoRepo.delete).toHaveBeenCalledWith('a1');
  });
});

import { ForbiddenException } from '@nestjs/common';
import { ProfessorEntity } from '../professor/entities/professor.entity';
import { AlocacaoEntity } from './entities/alocacao.entity';
import { TopicoEntity } from './entities/topico.entity';
import { AlocacaoService } from './alocacao.service';
import { TopicoService } from './topico.service';

const professorFake = (
  plano: 'ESTAGIARIO' | 'GRADUADO' | 'MESTRE' | 'PHD' = 'GRADUADO',
) =>
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

  it('bloqueia abaixo do plano Graduado (Estagiario)', async () => {
    const service = new TopicoService(
      {} as never,
      {} as never,
      professorFake('ESTAGIARIO'),
    );
    await expect(service.listar('p1', 'Web')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('permite o quadro modular ja no plano Graduado', async () => {
    const topicoRepo = {
      findByDisciplina: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(async (t) => t),
    };
    const service = new TopicoService(
      topicoRepo as never,
      {} as never,
      professorFake('GRADUADO'),
    );
    const criados = await service.adicionar('p1', 'Web', ['HTML', 'CSS']);
    expect(criados.map((t) => t.nome)).toEqual(['HTML', 'CSS']);
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

describe('AlocacaoService.definirRegulares (Unidades Eletivas)', () => {
  const turmaService = {
    buscarTurma: jest.fn().mockResolvedValue({ id: 'turma1' }),
  } as never;

  it('grava unidade+ordem sequencial para cada topico do board', async () => {
    const alocacaoRepo = {
      findByTurma: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue(undefined),
      createMany: jest.fn().mockImplementation(async (as) => as),
    };
    const service = new AlocacaoService(
      alocacaoRepo as never,
      professorFake('MESTRE'),
      turmaService,
    );
    const res = await service.definirRegulares('p1', 'turma1', [
      { unidade: 1, topicoIds: ['tA', 'tB', 'tC'] },
      { unidade: 3, topicoIds: ['tD'] },
    ]);
    expect(res).toHaveLength(4);
    expect(res.map((a) => [a.unidade, a.ordem, a.topicoId])).toEqual([
      [1, 0, 'tA'],
      [1, 1, 'tB'],
      [1, 2, 'tC'],
      [3, 0, 'tD'],
    ]);
    // nada a apagar (nao havia regulares) e nenhuma tem numeroAula
    expect(alocacaoRepo.deleteMany).toHaveBeenCalledWith([]);
    expect(res.every((a) => a.numeroAula === undefined)).toBe(true);
  });

  it('regrava idempotente: apaga so as regulares atuais, preserva as modulares', async () => {
    const alocacaoRepo = {
      findByTurma: jest.fn().mockResolvedValue([
        new AlocacaoEntity({ id: 'mod1', turmaId: 'turma1', numeroAula: 2, topicoId: 'tX' }),
        new AlocacaoEntity({ id: 'reg1', turmaId: 'turma1', unidade: 1, ordem: 0, topicoId: 'tA' }),
        new AlocacaoEntity({ id: 'reg2', turmaId: 'turma1', unidade: 2, ordem: 0, topicoId: 'tB' }),
      ]),
      deleteMany: jest.fn().mockResolvedValue(undefined),
      createMany: jest.fn().mockImplementation(async (as) => as),
    };
    const service = new AlocacaoService(
      alocacaoRepo as never,
      professorFake('MESTRE'),
      turmaService,
    );
    // reordena a unidade 1 (tA vira 2ª) — o board novo tem so a unidade 1.
    const res = await service.definirRegulares('p1', 'turma1', [
      { unidade: 1, topicoIds: ['tB', 'tA'] },
    ]);
    expect(alocacaoRepo.deleteMany).toHaveBeenCalledWith(['reg1', 'reg2']);
    expect(res.map((a) => [a.ordem, a.topicoId])).toEqual([
      [0, 'tB'],
      [1, 'tA'],
    ]);
  });

  it('bloqueia abaixo do plano Graduado (Estagiario)', async () => {
    const service = new AlocacaoService(
      {} as never,
      professorFake('ESTAGIARIO'),
      turmaService,
    );
    await expect(
      service.definirRegulares('p1', 'turma1', []),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

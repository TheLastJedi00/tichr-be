import { NotFoundException } from '@nestjs/common';
import { InstituicaoEntity } from '../instituicao/entities/instituicao.entity';
import { CreateTurmaDto } from './dto/create-turma.dto';
import { TurmaEntity } from './entities/turma.entity';
import { TurmaService } from './turma.service';

/**
 * Turma criada no painel da instituição (spec 027 §4): livre ou regular, ela
 * nasce ligada à instituição — desde que a instituição seja do professor.
 */
describe('TurmaService — vínculo com a instituição', () => {
  function make(instituicoes: InstituicaoEntity[] = []) {
    const turmas = new Map<string, TurmaEntity>();
    const turmaRepo = {
      findByProfessor: jest.fn(async () => [...turmas.values()]),
      findById: jest.fn(async (id: string) => turmas.get(id) ?? null),
      create: jest.fn(async (t: TurmaEntity) => {
        const salva = new TurmaEntity({ ...t, id: 't1' });
        turmas.set('t1', salva);
        return salva;
      }),
      update: jest.fn(async (id: string, dados: Partial<TurmaEntity>) => {
        Object.assign(turmas.get(id)!, dados);
      }),
    };
    const sessaoRepo = {
      deleteByTurma: jest.fn(async () => undefined),
      create: jest.fn(async (s: unknown) => s),
    };
    const vazio = { findByProfessor: jest.fn(async () => []) };
    const instituicaoRepo = {
      findById: jest.fn(
        async (id: string) => instituicoes.find((i) => i.id === id) ?? null,
      ),
    };
    const service = new TurmaService(
      turmaRepo as never,
      sessaoRepo as never,
      vazio as never,
      vazio as never,
      {} as never,
      instituicaoRepo as never,
    );
    return { service, turmas };
  }

  const livre = (over: Partial<CreateTurmaDto> = {}): CreateTurmaDto =>
    ({
      nome: 'Robótica',
      tipoModalidade: 'GRADE_FIXA',
      dataInicio: '2026-10-19',
      diasSemana: [1],
      ensinoRegular: false,
      ...over,
    }) as CreateTurmaDto;

  const escola = new InstituicaoEntity({
    id: 'i1',
    professorId: 'p1',
    nome: 'Escola',
  });

  it('turma livre criada com instituição nasce ligada a ela', async () => {
    const { service } = make([escola]);
    const { turma } = await service.criarTurma(
      'p1',
      livre({ instituicaoId: 'i1' }),
    );
    expect(turma.instituicaoId).toBe('i1');
    expect(turma.ensinoRegular).toBe(false);
  });

  it('sem instituição, a turma continua sem vínculo', async () => {
    const { service } = make([escola]);
    const { turma } = await service.criarTurma('p1', livre());
    expect(turma.instituicaoId).toBeUndefined();
  });

  it('instituição de outro professor → 404 INSTITUICAO_NAO_ENCONTRADA', async () => {
    const alheia = new InstituicaoEntity({ id: 'i2', professorId: 'p2' });
    const { service, turmas } = make([alheia]);
    const r = service.criarTurma('p1', livre({ instituicaoId: 'i2' }));
    await expect(r).rejects.toBeInstanceOf(NotFoundException);
    await expect(r).rejects.toMatchObject({
      response: { code: 'INSTITUICAO_NAO_ENCONTRADA' },
    });
    expect(turmas.size).toBe(0);
  });

  it('instituição inexistente → 404', async () => {
    const { service } = make([]);
    await expect(
      service.criarTurma('p1', livre({ instituicaoId: 'nada' })),
    ).rejects.toMatchObject({
      response: { code: 'INSTITUICAO_NAO_ENCONTRADA' },
    });
  });

  it('mover a turma para instituição alheia também é barrado', async () => {
    const alheia = new InstituicaoEntity({ id: 'i2', professorId: 'p2' });
    const { service, turmas } = make([escola, alheia]);
    await service.criarTurma('p1', livre({ instituicaoId: 'i1' }));
    await expect(
      service.atualizarTurma('p1', 't1', { instituicaoId: 'i2' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(turmas.get('t1')!.instituicaoId).toBe('i1');
  });
});

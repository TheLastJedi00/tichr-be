import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { WOR, WorMatchEntity } from './entities/wor-match.entity';
import { WorTeamEntity } from './entities/wor-team.entity';
import { WorGameService } from './wor-game.service';
import { WorJogoRepository } from './wor-jogo.repository';
import { WorMatchRepository } from './wor-match.repository';
import { XpService } from '../turma/xp.service';

/** Pausar e retomar o Wor (028 §4). Relógio mockado. */
function cenarioWorPausa(over: Partial<WorMatchEntity> = {}) {
  const T0 = Date.parse('2026-10-15T12:00:00.000Z');
  const teams = [
    new WorTeamEntity({
      id: 'e1',
      nome: 'Azul',
      hp: 1000,
      membros: [{ alunoId: 'a1', nome: 'Ana' }],
    }),
    new WorTeamEntity({
      id: 'e2',
      nome: 'Rosa',
      hp: 1000,
      membros: [{ alunoId: 'a2', nome: 'Bia' }],
    }),
  ];
  const match = new WorMatchEntity({
    id: 'm1',
    jogoId: 'j1',
    professorId: 'p1',
    turmaId: 't1',
    status: 'EM_ANDAMENTO',
    ordemEquipes: ['e1', 'e2'],
    turnoEquipeId: 'e1',
    mascara: ['_', '_'],
    rodadaIniciadaEm: new Date(T0 - 10_000).toISOString(),
    ...over,
  });
  const patchesEquipes: Record<string, Partial<WorTeamEntity>> = {};
  const matches = {
    buscar: jest.fn(async () => match),
    listarTeams: jest.fn(async () => teams),
    atualizar: jest.fn(async (_id: string, d: Partial<WorMatchEntity>) => {
      Object.assign(match, d);
    }),
    commitPartida: jest.fn(
      async (
        _m: string,
        raiz: Partial<WorMatchEntity>,
        equipes: Record<string, Partial<WorTeamEntity>> = {},
      ) => {
        Object.assign(match, raiz);
        for (const [id, d] of Object.entries(equipes)) {
          patchesEquipes[id] = { ...(patchesEquipes[id] ?? {}), ...d };
        }
      },
    ),
  } as unknown as WorMatchRepository;
  const jogos = {
    findById: jest.fn(async () => ({
      id: 'j1',
      palavras: [{ palavra: 'OI', dicas: ['d1', 'd2'] }],
    })),
  } as unknown as WorJogoRepository;
  const xp = {
    penalizarJogo: jest.fn(),
    creditarPartida: jest.fn(),
  } as unknown as XpService;
  return {
    service: new WorGameService(jogos, matches, xp),
    match,
    teams,
    patchesEquipes,
    matches,
    T0,
  };
}

describe('WorGameService — pausa', () => {
  let agora = 0;
  const relogio = (t: number) => {
    agora = t;
  };
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockImplementation(() => agora);
  });
  afterEach(() => jest.restoreAllMocks());

  it('pausar grava pausadaEm; de novo é idempotente', async () => {
    const ctx = cenarioWorPausa();
    relogio(ctx.T0);
    await ctx.service.pausar('p1', 'm1');
    expect(ctx.match.pausadaEm).toBe(new Date(ctx.T0).toISOString());
    relogio(ctx.T0 + 5_000);
    await ctx.service.pausar('p1', 'm1');
    expect(ctx.match.pausadaEm).toBe(new Date(ctx.T0).toISOString());
  });

  it('retomar empurra rodadaIniciadaEm pelo tempo pausado', async () => {
    const ctx = cenarioWorPausa();
    relogio(ctx.T0);
    await ctx.service.pausar('p1', 'm1');
    relogio(ctx.T0 + 30_000);
    await ctx.service.retomar('p1', 'm1');

    expect(ctx.match.pausadaEm).toBeNull();
    expect(ctx.match.rodadaIniciadaEm).toBe(
      new Date(ctx.T0 - 10_000 + 30_000).toISOString(),
    );
  });

  it('o card em cartaz também é empurrado, na raiz e nas equipes', async () => {
    const card = {
      seq: 3,
      tipo: 'DANO' as never,
      mensagem: 'Boom',
      duracaoMs: WOR.FREEZE_MS,
      em: new Date(
        Date.parse('2026-10-15T12:00:00.000Z') - 1_000,
      ).toISOString(),
    };
    const ctx = cenarioWorPausa({ lastGlobalAction: card });
    relogio(ctx.T0);
    await ctx.service.pausar('p1', 'm1');
    relogio(ctx.T0 + 20_000);
    await ctx.service.retomar('p1', 'm1');

    const empurrado = new Date(ctx.T0 - 1_000 + 20_000).toISOString();
    expect(ctx.match.lastGlobalAction?.em).toBe(empurrado);
    expect(ctx.patchesEquipes['e1'].lastGlobalAction?.em).toBe(empurrado);
    expect(ctx.patchesEquipes['e2'].lastGlobalAction?.em).toBe(empurrado);
  });

  it('card que já saiu de cena antes da pausa não volta', async () => {
    const em = new Date(
      Date.parse('2026-10-15T12:00:00.000Z') - 60_000,
    ).toISOString();
    const ctx = cenarioWorPausa({
      lastGlobalAction: {
        seq: 1,
        tipo: 'DANO' as never,
        mensagem: 'velho',
        duracaoMs: WOR.FREEZE_MS,
        em,
      },
    });
    relogio(ctx.T0);
    await ctx.service.pausar('p1', 'm1');
    relogio(ctx.T0 + 20_000);
    await ctx.service.retomar('p1', 'm1');
    expect(ctx.match.lastGlobalAction?.em).toBe(em);
  });

  it('fora de andamento: 400; só o dono', async () => {
    for (const status of ['LOBBY', 'ENCERRADO'] as const) {
      const ctx = cenarioWorPausa({ status });
      await expect(ctx.service.pausar('p1', 'm1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
    const ctx = cenarioWorPausa();
    await expect(ctx.service.pausar('x', 'm1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(ctx.service.retomar('x', 'm1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

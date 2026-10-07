import { WorGameService } from './wor-game.service';
import { WorMatchRepository } from './wor-match.repository';
import { WorJogoRepository } from './wor-jogo.repository';
import { WOR, WorMatchEntity } from './entities/wor-match.entity';
import { WorTeamEntity } from './entities/wor-team.entity';
import { XpService } from '../turma/xp.service';

/**
 * A penalidade por linguagem imprópria no chat: o aluno perde XP no ranking da
 * sala, o castelo da equipe perde HP e o alerta (com o nome do aluno) vai só
 * para o telão e para a equipe infratora.
 */
function cenario(teams: WorTeamEntity[], turmaId: string | null = 't1') {
  const inicio = new Date('2026-10-07T12:00:00Z').toISOString();
  const match = new WorMatchEntity({
    id: 'm1',
    jogoId: 'j1',
    professorId: 'p1',
    turmaId,
    status: 'EM_ANDAMENTO',
    ordemEquipes: teams.map((t) => t.id),
    turnoEquipeId: teams[0].id,
    rodadaIniciadaEm: inicio,
  });
  const patchesEquipes: Record<string, Partial<WorTeamEntity>> = {};
  const matches = {
    buscar: () => Promise.resolve(new WorMatchEntity({ ...match })),
    listarTeams: () =>
      Promise.resolve(teams.map((t) => new WorTeamEntity({ ...t }))),
    commitPartida: (
      _m: string,
      raiz: Partial<WorMatchEntity>,
      equipes: Record<string, Partial<WorTeamEntity>> = {},
    ) => {
      Object.assign(match, raiz);
      for (const [id, d] of Object.entries(equipes)) {
        patchesEquipes[id] = { ...(patchesEquipes[id] ?? {}), ...d };
        const t = teams.find((x) => x.id === id);
        if (t) Object.assign(t, d);
      }
      return Promise.resolve();
    },
  } as unknown as WorMatchRepository;
  const jogos = {} as unknown as WorJogoRepository;
  const penalizar = jest.fn(() => Promise.resolve());
  const xp = { penalizarJogo: penalizar } as unknown as XpService;
  return {
    service: new WorGameService(jogos, matches, xp),
    match,
    teams,
    patchesEquipes,
    penalizar,
    inicio,
  };
}

const time = (id: string, nome: string, membros: string[], hp = 1000) =>
  new WorTeamEntity({
    id,
    nome,
    hp,
    isHorde: hp === 0,
    membros: membros.map((a) => ({ alunoId: a, nome: a.toUpperCase() })),
  });

describe('Tichr Wor — penalidade de moderação (Task 4)', () => {
  it('a equipe perde 100 HP e o placar reflete', async () => {
    const teams = [
      time('e1', 'Dragões', ['ana']),
      time('e2', 'Grifos', ['bia']),
    ];
    const { service, match } = cenario(teams);
    await service.penalizarModeracao('m1', 'ana');
    expect(teams[0].hp).toBe(1000 - WOR.PENALIDADE_HP);
    expect(match.placar.find((p) => p.id === 'e1')?.hp).toBe(900);
    expect(teams[1].hp).toBe(1000);
  });

  it('o aluno perde 1000 de XP no ranking da sala', async () => {
    const teams = [
      time('e1', 'Dragões', ['ana']),
      time('e2', 'Grifos', ['bia']),
    ];
    const { service, penalizar } = cenario(teams);
    await service.penalizarModeracao('m1', 'ana');
    expect(penalizar).toHaveBeenCalledWith(
      't1',
      'ana',
      WOR.PENALIDADE_XP,
      'WOR_MODERACAO',
    );
  });

  it('o alerta com o nome do aluno vai ao telão e à equipe infratora — não às rivais', async () => {
    const teams = [
      time('e1', 'Dragões', ['ana']),
      time('e2', 'Grifos', ['bia']),
    ];
    const { service, match, patchesEquipes } = cenario(teams);
    await service.penalizarModeracao('m1', 'ana');
    expect(match.lastGlobalAction?.tipo).toBe('MODERACAO');
    expect(match.lastGlobalAction?.mensagem).toContain('ANA');
    expect(patchesEquipes.e1?.lastGlobalAction?.tipo).toBe('MODERACAO');
    expect(patchesEquipes.e2?.lastGlobalAction).toBeUndefined();
  });

  it('o card congela a rodada em curso por 3s, como os demais', async () => {
    const teams = [
      time('e1', 'Dragões', ['ana']),
      time('e2', 'Grifos', ['bia']),
    ];
    const { service, match, inicio } = cenario(teams);
    await service.penalizarModeracao('m1', 'ana');
    expect(Date.parse(match.rodadaIniciadaEm!) - Date.parse(inicio)).toBe(
      WOR.FREEZE_MS,
    );
  });

  it('pode derrubar o castelo: a equipe vira Horda', async () => {
    const teams = [
      time('e1', 'Dragões', ['ana'], 80),
      time('e2', 'Grifos', ['bia']),
    ];
    const { service } = cenario(teams);
    await service.penalizarModeracao('m1', 'ana');
    expect(teams[0].hp).toBe(0);
    expect(teams[0].isHorde).toBe(true);
  });

  it('a Horda não tem HP a perder: só o XP', async () => {
    const teams = [
      time('e1', 'Dragões', ['ana'], 0),
      time('e2', 'Grifos', ['bia']),
    ];
    const { service, match, penalizar } = cenario(teams);
    await service.penalizarModeracao('m1', 'ana');
    expect(teams[0].hp).toBe(0);
    expect(penalizar).toHaveBeenCalled();
    expect(match.lastGlobalAction?.mensagem).not.toContain('HP');
  });

  it('partida sem turma: sem ranking para debitar, só o HP', async () => {
    const teams = [
      time('e1', 'Dragões', ['ana']),
      time('e2', 'Grifos', ['bia']),
    ];
    const { service, penalizar } = cenario(teams, null);
    await service.penalizarModeracao('m1', 'ana');
    expect(penalizar).not.toHaveBeenCalled();
    expect(teams[0].hp).toBe(900);
  });
});

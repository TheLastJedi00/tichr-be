import { fakeWor, JOGO_TESTE, partidaTeste } from './wor.fake';
import { WOR } from './entities/wor-match.entity';
import { WorTeamEntity } from './entities/wor-team.entity';
import { XpService } from '../turma/xp.service';

/**
 * A penalidade por linguagem imprópria no chat: o aluno perde XP no ranking da
 * sala, o castelo da equipe perde HP e o alerta (com o nome do aluno) vai só
 * para o telão e para a equipe infratora.
 */
function cenario(teams: WorTeamEntity[], turmaId: string | null = 't1') {
  const inicio = new Date('2026-10-07T12:00:00Z').toISOString();
  const match = partidaTeste(teams, { turmaId, rodadaIniciadaEm: inicio });
  const penalizar = jest.fn(() => Promise.resolve());
  const xp = { penalizarJogo: penalizar } as unknown as XpService;
  const f = fakeWor(JOGO_TESTE, match, teams, { xp });
  /** O que cada equipe recebeu na transação da penalidade. */
  const patchesEquipes = new Proxy(
    {},
    {
      get: (_t, id: string) => f.transacoes.at(-1)?.equipes?.[id],
    },
  );
  return {
    service: f.service,
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

  it('em partida casual a penalidade continua debitando o ranking', async () => {
    const teams = [
      time('e1', 'Dragões', ['ana']),
      time('e2', 'Grifos', ['bia']),
    ];
    const { service, match, penalizar } = cenario(teams);
    match.valeRanking = false;
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

  it('se derrubar o castelo de quem não fechou, a equipe fecha como CAIU', async () => {
    const teams = [
      time('e1', 'Dragões', ['ana', 'duda'], 80),
      time('e2', 'Grifos', ['bia']),
    ];
    const { service, match } = cenario(teams);
    await service.penalizarModeracao('m1', 'ana');
    expect(match.equipesFechadas).toEqual([
      { equipeId: 'e1', ordem: 1, resultado: 'CAIU' },
    ]);
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

import { WorGameService } from './wor-game.service';
import { WorMatchRepository } from './wor-match.repository';
import { WorJogoRepository } from './wor-jogo.repository';
import { WorMatchEntity, WOR } from './entities/wor-match.entity';
import { WorTeamEntity } from './entities/wor-team.entity';
import { WorJogoEntity } from './entities/wor-jogo.entity';

/**
 * Repositório fake stateful: guarda match + teams em memória e aplica os
 * `atualizar`/`atualizarTeam`, permitindo testar o core loop de ponta a ponta.
 */
function fakeRepos(jogo: WorJogoEntity, match: WorMatchEntity, teams: WorTeamEntity[]) {
  const matches = {
    buscar: async () => new WorMatchEntity({ ...match }),
    atualizar: async (_id: string, dados: Partial<WorMatchEntity>) =>
      Object.assign(match, dados),
    listarTeams: async () => teams.map((t) => new WorTeamEntity({ ...t })),
    buscarTeam: async (_m: string, id: string) => {
      const t = teams.find((x) => x.id === id);
      return t ? new WorTeamEntity({ ...t }) : null;
    },
    atualizarTeam: async (_m: string, id: string, dados: Partial<WorTeamEntity>) => {
      const t = teams.find((x) => x.id === id);
      if (t) Object.assign(t, dados);
    },
  } as unknown as WorMatchRepository;
  const jogos = { findById: async () => jogo } as unknown as WorJogoRepository;
  return new WorGameService(jogos, matches);
}

const JOGO = new WorJogoEntity({
  id: 'j1',
  palavras: [
    { id: 'w1', palavra: 'ARTE', dicas: ['d1', 'd2', 'd3'] },
    { id: 'w2', palavra: 'REI', dicas: ['x1'] },
  ],
});

/** Monta um cenário EM_ANDAMENTO na onda 0 (ARTE) com as equipes dadas. */
function cenario(teams: WorTeamEntity[], turno = 'equipe-1') {
  const match = new WorMatchEntity({
    id: 'm1',
    jogoId: 'j1',
    status: 'EM_ANDAMENTO',
    ondaIndex: 0,
    totalOndas: 2,
    mascara: ['_', '_', '_', '_'],
    letrasTentadas: [],
    cartasVisiveis: ['d1'],
    totalCartas: 3,
    ordemEquipes: teams.map((t) => t.id),
    turnoEquipeId: turno,
    acoesRodada: [],
  });
  return { service: fakeRepos(JOGO, match, teams), match, teams };
}

const time = (id: string, membros: string[], hp = WOR.HP_INICIAL, isHorde = false) =>
  new WorTeamEntity({
    id,
    hp,
    isHorde,
    membros: membros.map((a) => ({ alunoId: a, nome: a.toUpperCase() })),
  });

describe('WorGameService — rodada por membros', () => {
  it('erro na letra: SEM dano ao próprio castelo + passa o turno', async () => {
    const teams = [time('equipe-1', ['a1']), time('equipe-2', ['b1'])];
    const { service, match } = cenario(teams);
    await service.chutarLetra('a1', 'm1', 'Z', 'ATACAR', 'equipe-2');
    expect(teams[0].hp).toBe(WOR.HP_INICIAL); // não perde HP por errar letra
    expect(match.turnoEquipeId).toBe('equipe-2');
    expect(match.letrasTentadas).toContain('Z');
  });

  it('acerto (equipe de 1): ataca o rival votado com dano padrão (100)', async () => {
    const teams = [time('equipe-1', ['a1']), time('equipe-2', ['b1'])];
    const { service, match } = cenario(teams);
    await service.chutarLetra('a1', 'm1', 'A', 'ATACAR', 'equipe-2');
    expect(match.mascara).toEqual(['A', '_', '_', '_']);
    expect(teams[1].hp).toBe(WOR.HP_INICIAL - WOR.DANO_ATAQUE); // 900 (solo nunca é crítico)
    expect(match.turnoEquipeId).toBe('equipe-2');
  });

  it('rejeita jogar fora do turno', async () => {
    const teams = [time('equipe-1', ['a1']), time('equipe-2', ['b1'])];
    const { service } = cenario(teams);
    await expect(
      service.chutarLetra('b1', 'm1', 'A', 'ATACAR', 'equipe-1'),
    ).rejects.toMatchObject({ response: { code: 'FORA_DO_TURNO' } });
  });

  it('acerto votando DICA revela a próxima carta', async () => {
    const teams = [time('equipe-1', ['a1']), time('equipe-2', ['b1'])];
    const { service, match } = cenario(teams);
    await service.chutarLetra('a1', 'm1', 'A', 'DICA');
    expect(match.cartasVisiveis).toEqual(['d1', 'd2']);
  });

  it('crítico: os 2 membros acertam a letra → 200 no rival mais votado', async () => {
    const teams = [
      time('equipe-1', ['a1', 'a2']),
      time('equipe-2', ['b1']),
      time('equipe-3', ['c1']),
    ];
    const { service, match } = cenario(teams);
    await service.chutarLetra('a1', 'm1', 'A', 'ATACAR', 'equipe-2'); // acumula (1/2)
    await service.chutarLetra('a2', 'm1', 'R', 'ATACAR', 'equipe-2'); // 2/2 → resolve
    expect(teams[1].hp).toBe(WOR.HP_INICIAL - WOR.DANO_CRITICO); // 800
    expect(teams[2].hp).toBe(WOR.HP_INICIAL);
    expect(match.turnoEquipeId).toBe('equipe-2');
  });

  it('não-crítico: um membro erra a letra → dano padrão (100)', async () => {
    const teams = [time('equipe-1', ['a1', 'a2']), time('equipe-2', ['b1'])];
    const { service } = cenario(teams);
    await service.chutarLetra('a1', 'm1', 'A', 'ATACAR', 'equipe-2'); // acerta
    await service.chutarLetra('a2', 'm1', 'Z', 'ATACAR', 'equipe-2'); // erra → resolve
    expect(teams[1].hp).toBe(WOR.HP_INICIAL - WOR.DANO_ATAQUE); // 900 (não deu crítico)
  });

  it('votação: o rival mais votado (entre quem acertou) leva o dano', async () => {
    const teams = [
      time('equipe-1', ['a1', 'a2', 'a3']),
      time('equipe-2', ['b1']),
      time('equipe-3', ['c1']),
    ];
    const { service } = cenario(teams);
    await service.chutarLetra('a1', 'm1', 'A', 'ATACAR', 'equipe-2');
    await service.chutarLetra('a2', 'm1', 'R', 'ATACAR', 'equipe-3');
    await service.chutarLetra('a3', 'm1', 'T', 'ATACAR', 'equipe-3'); // resolve
    expect(teams[2].hp).toBe(WOR.HP_INICIAL - WOR.DANO_CRITICO); // equipe-3, todos acertaram
    expect(teams[1].hp).toBe(WOR.HP_INICIAL);
  });

  it('arriscar certo: Cura Massiva + avança a onda', async () => {
    const teams = [time('equipe-1', ['a1'], 500), time('equipe-2', ['b1'])];
    const { service, match } = cenario(teams);
    await service.arriscar('a1', 'm1', 'arte');
    expect(teams[0].hp).toBe(Math.min(WOR.HP_INICIAL, 500 + WOR.CURA_MASSIVA)); // 900
    expect(match.ondaIndex).toBe(1);
    expect(match.mascara).toEqual(['_', '_', '_']); // REI mascarada
  });

  it('arriscar errado: Dano Crítico no próprio castelo + passa o turno', async () => {
    const teams = [time('equipe-1', ['a1']), time('equipe-2', ['b1'])];
    const { service, match } = cenario(teams);
    await service.arriscar('a1', 'm1', 'rainha');
    expect(teams[0].hp).toBe(WOR.HP_INICIAL - WOR.DANO_CRITICO); // 800
    expect(match.turnoEquipeId).toBe('equipe-2');
  });

  it('completar a última onda encerra a partida com o vencedor de maior HP', async () => {
    const teams = [time('equipe-1', ['a1'], 700), time('equipe-2', ['b1'], 900)];
    const { service, match } = cenario(teams);
    match.ondaIndex = 1; // última onda (REI)
    match.mascara = ['R', 'E', '_'];
    match.letrasTentadas = ['R', 'E'];
    await service.chutarLetra('a1', 'm1', 'I', 'ATACAR', 'equipe-2'); // completa REI
    expect(match.status).toBe('ENCERRADO');
    expect(match.vencedorEquipeId).toBe('equipe-2');
  });
});

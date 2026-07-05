import { WorGameService } from './wor-game.service';
import { WorMatchRepository } from './wor-match.repository';
import { WorJogoRepository } from './wor-jogo.repository';
import { WorMatchEntity, WOR } from './entities/wor-match.entity';
import { WorTeamEntity } from './entities/wor-team.entity';
import { WorJogoEntity } from './entities/wor-jogo.entity';

/**
 * Repositório fake stateful: guarda match + teams em memória e aplica os
 * `atualizar`/`atualizarTeam`, permitindo testar o fluxo do core loop de ponta a ponta.
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
  const jogos = {
    findById: async () => jogo,
  } as unknown as WorJogoRepository;
  return { service: new WorGameService(jogos, matches), match, teams };
}

function cenario() {
  const jogo = new WorJogoEntity({
    id: 'j1',
    palavras: [
      { id: 'w1', palavra: 'REI', dicas: ['d1', 'd2', 'd3'] },
      { id: 'w2', palavra: 'ARTE', dicas: ['x1'] },
    ],
  });
  const match = new WorMatchEntity({
    id: 'm1',
    jogoId: 'j1',
    status: 'EM_ANDAMENTO',
    ondaIndex: 0,
    totalOndas: 2,
    mascara: ['_', '_', '_'],
    letrasTentadas: [],
    cartasVisiveis: ['d1'],
    totalCartas: 3,
    ordemEquipes: ['equipe-1', 'equipe-2'],
    turnoEquipeId: 'equipe-1',
    aguardandoDilema: false,
  });
  const teams = [
    new WorTeamEntity({ id: 'equipe-1', hp: 100, membros: [{ alunoId: 'a1', nome: 'A' }] }),
    new WorTeamEntity({ id: 'equipe-2', hp: 100, membros: [{ alunoId: 'a2', nome: 'B' }] }),
  ];
  return fakeRepos(jogo, match, teams);
}

describe('WorGameService — core loop (Fase 4)', () => {
  it('erro na letra: Dano do Sistema no próprio castelo + passa o turno', async () => {
    const { service, match, teams } = cenario();
    await service.chutarLetra('a1', 'm1', 'Z');
    expect(teams[0].hp).toBe(100 - WOR.DANO_SISTEMA);
    expect(match.turnoEquipeId).toBe('equipe-2');
    expect(match.letrasTentadas).toContain('Z');
  });

  it('acerto da letra abre o Dilema Tático (sem completar)', async () => {
    const { service, match } = cenario();
    await service.chutarLetra('a1', 'm1', 'R');
    expect(match.mascara).toEqual(['R', '_', '_']);
    expect(match.aguardandoDilema).toBe(true);
    expect(match.dilemaEquipeId).toBe('equipe-1');
  });

  it('rejeita jogar fora do turno', async () => {
    const { service } = cenario();
    await expect(service.chutarLetra('a2', 'm1', 'R')).rejects.toMatchObject({
      response: { code: 'FORA_DO_TURNO' },
    });
  });

  it('Dilema ATACAR causa dano no rival e passa o turno', async () => {
    const { service, match, teams } = cenario();
    await service.chutarLetra('a1', 'm1', 'R'); // abre dilema
    await service.resolverDilema('a1', 'm1', 'ATACAR', 'equipe-2');
    expect(teams[1].hp).toBe(100 - WOR.DANO_ATAQUE);
    expect(match.aguardandoDilema).toBe(false);
    expect(match.turnoEquipeId).toBe('equipe-2');
  });

  it('Dilema COMPRAR_DICA revela a próxima carta', async () => {
    const { service, match } = cenario();
    await service.chutarLetra('a1', 'm1', 'R');
    await service.resolverDilema('a1', 'm1', 'COMPRAR_DICA');
    expect(match.cartasVisiveis).toEqual(['d1', 'd2']);
  });

  it('arriscar certo: Cura Massiva + avança a onda', async () => {
    const { service, match, teams } = cenario();
    teams[0].hp = 50;
    await service.arriscar('a1', 'm1', 'rei');
    expect(teams[0].hp).toBe(Math.min(100, 50 + WOR.CURA_MASSIVA));
    expect(match.ondaIndex).toBe(1);
    expect(match.mascara).toEqual(['_', '_', '_', '_']); // ARTE mascarada
  });

  it('arriscar errado: Dano Crítico + passa o turno', async () => {
    const { service, match, teams } = cenario();
    await service.arriscar('a1', 'm1', 'rainha');
    expect(teams[0].hp).toBe(100 - WOR.DANO_CRITICO);
    expect(match.turnoEquipeId).toBe('equipe-2');
  });

  it('completar a última onda encerra a partida com vencedor de maior HP', async () => {
    const { service, match, teams } = cenario();
    match.ondaIndex = 1; // última onda (ARTE)
    match.mascara = ['A', 'R', 'T', '_'];
    match.letrasTentadas = ['A', 'R', 'T'];
    teams[0].hp = 70;
    teams[1].hp = 90;
    await service.chutarLetra('a1', 'm1', 'E'); // completa ARTE
    expect(match.status).toBe('ENCERRADO');
    expect(match.vencedorEquipeId).toBe('equipe-2');
  });
});

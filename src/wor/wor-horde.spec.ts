import { WorGameService } from './wor-game.service';
import { WorMatchRepository } from './wor-match.repository';
import { WorJogoRepository } from './wor-jogo.repository';
import { WorMatchEntity } from './entities/wor-match.entity';
import { WorTeamEntity } from './entities/wor-team.entity';
import { WorJogoEntity } from './entities/wor-jogo.entity';
import { XpService } from '../turma/xp.service';

const fakeXp = () =>
  ({ creditarPartida: async () => undefined }) as unknown as XpService;

function repos(jogo: WorJogoEntity, match: WorMatchEntity, teams: WorTeamEntity[]) {
  const matches = {
    buscar: async () => new WorMatchEntity({ ...match }),
    atualizar: async (_i: string, d: Partial<WorMatchEntity>) => Object.assign(match, d),
    listarTeams: async () => teams.map((t) => new WorTeamEntity({ ...t })),
    buscarTeam: async (_m: string, id: string) => {
      const t = teams.find((x) => x.id === id);
      return t ? new WorTeamEntity({ ...t }) : null;
    },
    atualizarTeam: async (_m: string, id: string, d: Partial<WorTeamEntity>) => {
      const t = teams.find((x) => x.id === id);
      if (t) Object.assign(t, d);
    },
  } as unknown as WorMatchRepository;
  const jogos = { findById: async () => jogo } as unknown as WorJogoRepository;
  return new WorGameService(jogos, matches, fakeXp());
}

describe('Tichr Wor — Horda e Usurpação (Fase 5)', () => {
  const jogo = new WorJogoEntity({
    id: 'j1',
    palavras: [
      { id: 'w1', palavra: 'REI', dicas: ['d1'] },
      { id: 'w2', palavra: 'ARTE', dicas: [] },
    ],
  });

  function base() {
    const match = new WorMatchEntity({
      id: 'm1',
      jogoId: 'j1',
      professorId: 'p1',
      status: 'EM_ANDAMENTO',
      ondaIndex: 0,
      totalOndas: 2,
      ordemEquipes: ['equipe-1', 'equipe-2'],
      turnoEquipeId: 'equipe-1',
      acoesRodada: [],
    });
    const teams = [
      new WorTeamEntity({ id: 'equipe-1', hp: 0, isHorde: true, membros: [{ alunoId: 'a1', nome: 'A' }] }),
      new WorTeamEntity({ id: 'equipe-2', hp: 90, isHorde: false, membros: [{ alunoId: 'a2', nome: 'B' }] }),
    ];
    return { match, teams };
  }

  it('a Horda não pode chutar letra (só Invasão)', async () => {
    const { match, teams } = base();
    const svc = repos(jogo, match, teams);
    await expect(
      svc.chutarLetra('a1', 'm1', 'R', 'ATACAR', 'equipe-2'),
    ).rejects.toThrow();
  });

  it('Invasão certa: a Horda rouba o castelo do líder, que vira Horda', async () => {
    const { match, teams } = base();
    const svc = repos(jogo, match, teams);

    await svc.arriscar('a1', 'm1', 'REI');

    const invasora = teams.find((t) => t.id === 'equipe-1')!;
    const lider = teams.find((t) => t.id === 'equipe-2')!;
    expect(invasora.isHorde).toBe(false);
    expect(invasora.hp).toBe(90); // assumiu o castelo do líder
    expect(lider.isHorde).toBe(true);
    expect(lider.hp).toBe(0);
    expect(match.ondaIndex).toBe(1); // decifrou a palavra → avançou a onda
  });

  it('Invasão errada: Dano Crítico na própria Horda', async () => {
    const { match, teams } = base();
    teams[0].hp = 20;
    teams[0].isHorde = true;
    const svc = repos(jogo, match, teams);
    await svc.arriscar('a1', 'm1', 'RAINHA');
    expect(teams[0].hp).toBe(0); // 20 - DANO_CRITICO, clampa em 0
  });

  it('pular (mestre) avança a onda', async () => {
    const { match, teams } = base();
    const svc = repos(jogo, match, teams);
    await svc.pularPalavra('p1', 'm1');
    expect(match.ondaIndex).toBe(1);
  });
});

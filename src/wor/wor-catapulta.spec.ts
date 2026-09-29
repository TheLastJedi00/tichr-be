import { BadRequestException } from '@nestjs/common';
import { WorGameService } from './wor-game.service';
import { WorMatchRepository } from './wor-match.repository';
import { WorJogoRepository } from './wor-jogo.repository';
import { WOR, WorMatchEntity } from './entities/wor-match.entity';
import { WorTeamEntity } from './entities/wor-team.entity';
import { WorJogoEntity } from './entities/wor-jogo.entity';
import { XpService } from '../turma/xp.service';

/**
 * O Risco Heroico com escolha: acertar a palavra inteira dá à equipe comum
 * Recuperar HP (a Cura Massiva de sempre) ou a Catapulta num castelo rival.
 * A palavra da onda 0 é ARTE.
 */
function cenario(teams: WorTeamEntity[], turno = 'equipe-1') {
  const match = new WorMatchEntity({
    id: 'm1',
    jogoId: 'j1',
    professorId: 'p1',
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
    rodadaIniciadaEm: new Date().toISOString(),
  });
  const jogo = new WorJogoEntity({
    id: 'j1',
    palavras: [
      { id: 'w1', palavra: 'ARTE', dicas: ['d1', 'd2', 'd3'] },
      { id: 'w2', palavra: 'REI', dicas: ['x1'] },
    ],
  });
  const matches = {
    buscar: async () => new WorMatchEntity({ ...match }),
    atualizar: async (_i: string, d: Partial<WorMatchEntity>) =>
      Object.assign(match, d),
    listarTeams: async () => teams.map((t) => new WorTeamEntity({ ...t })),
    buscarTeam: async (_m: string, id: string) => {
      const t = teams.find((x) => x.id === id);
      return t ? new WorTeamEntity({ ...t }) : null;
    },
    atualizarTeam: async (_m: string, id: string, d: Partial<WorTeamEntity>) => {
      const t = teams.find((x) => x.id === id);
      if (t) Object.assign(t, d);
    },
    commitPartida: async (
      _m: string,
      raiz: Partial<WorMatchEntity>,
      equipes: Record<string, Partial<WorTeamEntity>> = {},
    ) => {
      Object.assign(match, raiz);
      for (const [id, d] of Object.entries(equipes)) {
        const t = teams.find((x) => x.id === id);
        if (t) Object.assign(t, d);
      }
    },
  } as unknown as WorMatchRepository;
  const jogos = { findById: async () => jogo } as unknown as WorJogoRepository;
  const xp = { creditarPartida: async () => undefined } as unknown as XpService;
  return { service: new WorGameService(jogos, matches, xp), match, teams };
}

const time = (
  id: string,
  nome: string,
  membros: string[],
  hp = WOR.HP_INICIAL,
  isHorde = false,
) =>
  new WorTeamEntity({
    id,
    nome,
    hp,
    isHorde,
    membros: membros.map((a) => ({ alunoId: a, nome: a.toUpperCase() })),
  });

const hp = (teams: WorTeamEntity[], id: string) =>
  teams.find((t) => t.id === id)!.hp;

describe('Tichr Wor — Catapulta: validação antes do palpite', () => {
  it('a Catapulta vale 300 de dano', () => {
    expect(WOR.DANO_CATAPULTA).toBe(300);
  });

  it('Catapulta sem alvo é recusada — e a tentativa NÃO é consumida', async () => {
    const teams = [
      time('equipe-1', 'Dragões', ['a1', 'a2']),
      time('equipe-2', 'Grifos', ['b1']),
    ];
    const { service, match } = cenario(teams);

    await expect(
      service.arriscar('a1', 'm1', 'arte', { efeito: 'CATAPULTA' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(match.acoesRodada).toEqual([]);
    expect(match.ondaIndex).toBe(0);
  });

  it('Catapulta no próprio castelo é recusada', async () => {
    const teams = [
      time('equipe-1', 'Dragões', ['a1']),
      time('equipe-2', 'Grifos', ['b1']),
    ];
    const { service } = cenario(teams);
    await expect(
      service.arriscar('a1', 'm1', 'arte', {
        efeito: 'CATAPULTA',
        alvoEquipeId: 'equipe-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('Catapulta numa Horda é recusada (não há castelo de pé para derrubar)', async () => {
    const teams = [
      time('equipe-1', 'Dragões', ['a1']),
      time('equipe-2', 'Grifos', ['b1'], 0, true),
    ];
    const { service } = cenario(teams);
    await expect(
      service.arriscar('a1', 'm1', 'arte', {
        efeito: 'CATAPULTA',
        alvoEquipeId: 'equipe-2',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('Catapulta num castelo inexistente é recusada', async () => {
    const teams = [
      time('equipe-1', 'Dragões', ['a1']),
      time('equipe-2', 'Grifos', ['b1']),
    ];
    const { service } = cenario(teams);
    await expect(
      service.arriscar('a1', 'm1', 'arte', {
        efeito: 'CATAPULTA',
        alvoEquipeId: 'equipe-9',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a Horda que envia efeito é ignorada: continua sendo Usurpação', async () => {
    const teams = [
      time('equipe-1', 'Bárbaros', ['a1'], 0, true),
      time('equipe-2', 'Grifos', ['b1'], 800),
    ];
    const { service, match } = cenario(teams);
    await service.arriscar('a1', 'm1', 'arte', {
      efeito: 'CATAPULTA',
      alvoEquipeId: 'equipe-2',
    });
    expect(match.lastGlobalAction?.tipo).toBe('USURPACAO');
    expect(hp(teams, 'equipe-1')).toBe(800); // tomou o castelo do líder
  });
});

describe('Tichr Wor — Risco Heroico: Recuperar HP × Catapulta', () => {
  it('Recuperar HP (padrão, sem efeito enviado) cura como sempre', async () => {
    const teams = [
      time('equipe-1', 'Dragões', ['a1'], 500),
      time('equipe-2', 'Grifos', ['b1']),
    ];
    const { service, match } = cenario(teams);
    await service.arriscar('a1', 'm1', 'arte');

    expect(hp(teams, 'equipe-1')).toBe(500 + WOR.CURA_MASSIVA);
    expect(hp(teams, 'equipe-2')).toBe(WOR.HP_INICIAL);
    expect(match.lastGlobalAction?.tipo).toBe('CURA');
  });

  it('Catapulta: 300 no rival escolhido, pontos de dano + bônus, card para todos e a onda avança', async () => {
    const teams = [
      time('equipe-1', 'Dragões', ['a1'], 500),
      time('equipe-2', 'Grifos', ['b1']),
      time('equipe-3', 'Fênix', ['c1']),
    ];
    const { service, match } = cenario(teams);
    await service.arriscar('a1', 'm1', 'arte', {
      efeito: 'CATAPULTA',
      alvoEquipeId: 'equipe-3',
    });

    expect(hp(teams, 'equipe-3')).toBe(WOR.HP_INICIAL - WOR.DANO_CATAPULTA);
    expect(hp(teams, 'equipe-1')).toBe(500); // não cura
    expect(hp(teams, 'equipe-2')).toBe(WOR.HP_INICIAL);
    expect(teams.find((t) => t.id === 'equipe-1')!.pontos).toBe(
      WOR.BONUS_ARRISCAR + WOR.DANO_CATAPULTA * WOR.PONTOS_POR_DANO,
    );
    expect(match.lastGlobalAction?.tipo).toBe('CATAPULTA');
    expect(match.lastGlobalAction?.mensagem).toBe(
      'A1 acertou a palavra e disparou a Catapulta! O castelo da Fênix sofreu 300 de dano!',
    );
    // O card chega a todas as equipes (o aluno só escuta o doc da sua).
    for (const t of teams) {
      expect(t.lastGlobalAction?.tipo).toBe('CATAPULTA');
    }
    expect(match.ondaIndex).toBe(1);
    // O placar da raiz reflete o HP novo.
    expect(match.placar?.find((p) => p.id === 'equipe-3')?.hp).toBe(
      WOR.HP_INICIAL - WOR.DANO_CATAPULTA,
    );
  });

  it('Catapulta que zera o HP derruba o castelo: o rival vira Horda', async () => {
    const teams = [
      time('equipe-1', 'Dragões', ['a1']),
      time('equipe-2', 'Grifos', ['b1'], 200),
    ];
    const { service, match } = cenario(teams);
    await service.arriscar('a1', 'm1', 'arte', {
      efeito: 'CATAPULTA',
      alvoEquipeId: 'equipe-2',
    });

    const grifos = teams.find((t) => t.id === 'equipe-2')!;
    expect(grifos.hp).toBe(0);
    expect(grifos.isHorde).toBe(true);
    expect(match.lastGlobalAction?.mensagem).toContain('e caiu!');
    // O dano que vira ponto é o que de fato saiu do castelo.
    expect(teams.find((t) => t.id === 'equipe-1')!.pontos).toBe(
      WOR.BONUS_ARRISCAR + 200 * WOR.PONTOS_POR_DANO,
    );
  });

  it('errar a palavra ignora a Catapulta: Dano Crítico no próprio castelo, alvo intacto', async () => {
    const teams = [
      time('equipe-1', 'Dragões', ['a1', 'a2']),
      time('equipe-2', 'Grifos', ['b1']),
    ];
    const { service, match } = cenario(teams);
    await service.arriscar('a1', 'm1', 'rainha', {
      efeito: 'CATAPULTA',
      alvoEquipeId: 'equipe-2',
    });

    expect(hp(teams, 'equipe-1')).toBe(WOR.HP_INICIAL - WOR.DANO_CRITICO);
    expect(hp(teams, 'equipe-2')).toBe(WOR.HP_INICIAL);
    expect(match.lastGlobalAction?.tipo).toBe('DANO_CRITICO');
  });
});

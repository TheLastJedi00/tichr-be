import { WorGameService } from './wor-game.service';
import { WorMatchRepository } from './wor-match.repository';
import { WorJogoRepository } from './wor-jogo.repository';
import { WOR, WorMatchEntity } from './entities/wor-match.entity';
import { WorTeamEntity } from './entities/wor-team.entity';
import { WorJogoEntity } from './entities/wor-jogo.entity';
import { XpService } from '../turma/xp.service';

/**
 * Action Cards: a narração global (§1 da spec). O que importa aqui é (a) o card
 * chegar em TODAS as equipes — o aluno só escuta o doc da sua — e (b) o jogo
 * congelar enquanto ele está no ar, o que no motor significa a rodada nascer 3s
 * no futuro (não existe timer no servidor para pausar).
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

/** Milissegundos entre o início da rodada gravado e agora (negativo = no futuro). */
const atraso = (match: WorMatchEntity) =>
  Date.parse(match.rodadaIniciadaEm as string) - Date.now();

describe('Tichr Wor — Action Cards (narração global + freeze)', () => {
  it('ataque: emite o card nomeando a EQUIPE e o dano no castelo alvo', async () => {
    const teams = [
      time('equipe-1', 'Dragões', ['a1']),
      time('equipe-2', 'Grifos', ['b1']),
    ];
    const { service, match } = cenario(teams);

    await service.chutarLetra('a1', 'm1', 'A', 'ATACAR', 'equipe-2');

    expect(match.lastGlobalAction?.tipo).toBe('ATAQUE');
    expect(match.lastGlobalAction?.mensagem).toBe(
      'A Dragões acertou 1 letra e causou 100 de dano no castelo da Grifos!',
    );
    expect(match.lastGlobalAction?.duracaoMs).toBe(WOR.FREEZE_MS);
  });

  it('fan-out: o card chega a TODAS as equipes, não só à do turno', async () => {
    const teams = [
      time('equipe-1', 'Dragões', ['a1']),
      time('equipe-2', 'Grifos', ['b1']),
      time('equipe-3', 'Fênix', ['c1']),
    ];
    const { service, match } = cenario(teams);

    await service.chutarLetra('a1', 'm1', 'A', 'ATACAR', 'equipe-2');

    for (const t of teams) {
      expect(t.lastGlobalAction?.seq).toBe(match.lastGlobalAction?.seq);
      expect(t.lastGlobalAction?.tipo).toBe('ATAQUE');
    }
  });

  it('freeze: a rodada nova nasce 3s no futuro (o cronômetro não corre no card)', async () => {
    const teams = [
      time('equipe-1', 'Dragões', ['a1']),
      time('equipe-2', 'Grifos', ['b1']),
    ];
    const { service, match } = cenario(teams);

    await service.chutarLetra('a1', 'm1', 'A', 'ATACAR', 'equipe-2');

    expect(atraso(match)).toBeGreaterThan(WOR.FREEZE_MS - 1000);
  });

  it('sem card (letra errada, sem dano) a rodada nova nasce agora — sem freeze', async () => {
    const teams = [
      time('equipe-1', 'Dragões', ['a1']),
      time('equipe-2', 'Grifos', ['b1']),
    ];
    const { service, match } = cenario(teams);

    await service.chutarLetra('a1', 'm1', 'Z', 'ATACAR', 'equipe-2');

    expect(match.lastGlobalAction).toBeUndefined();
    expect(atraso(match)).toBeLessThan(1000);
  });

  it('dica: o card narra a carta revelada pelo sacrifício', async () => {
    const teams = [
      time('equipe-1', 'Dragões', ['a1']),
      time('equipe-2', 'Grifos', ['b1']),
    ];
    const { service, match } = cenario(teams);

    await service.chutarLetra('a1', 'm1', 'A', 'DICA');

    expect(match.lastGlobalAction?.tipo).toBe('DICA');
    expect(match.lastGlobalAction?.mensagem).toBe(
      'A Dragões sacrificou seu ataque para revelar a Carta 2!',
    );
  });

  it('cura: o Risco Heroico bem-sucedido nomeia o ALUNO e congela a onda nova', async () => {
    const teams = [
      time('equipe-1', 'Dragões', ['a1'], 500),
      time('equipe-2', 'Grifos', ['b1']),
    ];
    const { service, match } = cenario(teams);

    await service.arriscar('a1', 'm1', 'arte');

    expect(match.lastGlobalAction?.tipo).toBe('CURA');
    expect(match.lastGlobalAction?.mensagem).toBe(
      'A1 arriscou tudo e acertou a palavra! A Dragões restaurou a vida do castelo!',
    );
    expect(match.ondaIndex).toBe(1); // avançou a onda...
    expect(atraso(match)).toBeGreaterThan(WOR.FREEZE_MS - 1000); // ...já congelada
  });

  it('dano crítico: o card sai e a rodada EM CURSO é adiada em 3s (não reiniciada)', async () => {
    const teams = [
      time('equipe-1', 'Dragões', ['a1', 'a2']),
      time('equipe-2', 'Grifos', ['b1']),
    ];
    const { service, match } = cenario(teams);
    const inicioOriginal = Date.parse(match.rodadaIniciadaEm as string);

    await service.arriscar('a1', 'm1', 'rainha'); // 1/2 membros → não resolve

    expect(match.lastGlobalAction?.tipo).toBe('DANO_CRITICO');
    expect(match.lastGlobalAction?.mensagem).toBe(
      'A1 arriscou a palavra e errou! A Dragões sofreu Dano Crítico!',
    );
    expect(match.turnoEquipeId).toBe('equipe-1'); // a rodada continua
    expect(Date.parse(match.rodadaIniciadaEm as string)).toBe(
      inicioOriginal + WOR.FREEZE_MS,
    );
  });

  it('usurpação: a Horda que acerta a palavra rouba o castelo do líder', async () => {
    const teams = [
      time('equipe-1', 'Horda', ['a1'], 0, true),
      time('equipe-2', 'Grifos', ['b1'], 900),
    ];
    const { service, match } = cenario(teams);

    await service.arriscar('a1', 'm1', 'arte');

    expect(match.lastGlobalAction?.tipo).toBe('USURPACAO');
    expect(match.lastGlobalAction?.mensagem).toBe(
      'A Horda de A1 acertou a palavra e ROUBOU o castelo da Grifos!',
    );
    expect(teams[0].hp).toBe(900);
    expect(teams[1].isHorde).toBe(true);
  });

  it('o Dano Crítico não é sobreposto pelo card da rodada que ele fecha', async () => {
    const teams = [
      time('equipe-1', 'Dragões', ['a1', 'a2']),
      time('equipe-2', 'Grifos', ['b1']),
    ];
    const { service, match } = cenario(teams);

    await service.chutarLetra('a1', 'm1', 'A', 'ATACAR', 'equipe-2'); // 1/2
    const seqAntes = match.lastGlobalAction?.seq;
    await service.arriscar('a2', 'm1', 'rainha'); // 2/2 → erra e resolve a rodada

    expect(seqAntes).toBeUndefined(); // a 1ª ação só acumulou, sem card
    expect(match.lastGlobalAction?.tipo).toBe('DANO_CRITICO');
    expect(teams[1].hp).toBe(WOR.HP_INICIAL - WOR.DANO_ATAQUE); // o ataque saiu
    expect(match.turnoEquipeId).toBe('equipe-2'); // e a rodada resolveu
  });

  it('seq incrementa a cada card (é o gatilho do cliente)', async () => {
    const teams = [
      time('equipe-1', 'Dragões', ['a1']),
      time('equipe-2', 'Grifos', ['b1']),
    ];
    const { service, match } = cenario(teams);

    await service.chutarLetra('a1', 'm1', 'A', 'ATACAR', 'equipe-2');
    expect(match.lastGlobalAction?.seq).toBe(1);
    await service.chutarLetra('b1', 'm1', 'R', 'ATACAR', 'equipe-1');
    expect(match.lastGlobalAction?.seq).toBe(2);
  });

  it('o professor não fecha a rodada por tempo enquanto o card está no ar', async () => {
    const teams = [
      time('equipe-1', 'Dragões', ['a1']),
      time('equipe-2', 'Grifos', ['b1']),
    ];
    const { service, match } = cenario(teams);
    // Rodada congelada: começou 3s à frente (card recém-emitido).
    match.rodadaIniciadaEm = new Date(Date.now() + WOR.FREEZE_MS).toISOString();

    await service.resolverPorTempo('p1', 'm1');

    expect(match.turnoEquipeId).toBe('equipe-1'); // o turno NÃO passou
  });
});

import { BadRequestException } from '@nestjs/common';
import {
  WOR,
  WorMatchEntity,
  LIMITE_RODADA_MS,
} from './entities/wor-match.entity';
import { WorTeamEntity } from './entities/wor-team.entity';
import { equipe, fakeWor, JOGO_TESTE, partidaTeste } from './wor.fake';

function cenario(teams: WorTeamEntity[], over: Partial<WorMatchEntity> = {}) {
  return fakeWor(JOGO_TESTE, partidaTeste(teams, over), teams);
}

/** Última onda (REI) faltando só o I. */
const ultimaOnda: Partial<WorMatchEntity> = {
  ondaIndex: 1,
  mascara: ['R', 'E', '_'],
  letrasTentadas: ['R', 'E'],
  cartasVisiveis: ['x1'],
  totalCartas: 1,
};

describe('Wor em paralelo — a rodada (029 §1)', () => {
  it('todas as equipes jogam a mesma rodada, sem turno', async () => {
    const teams = [equipe('e1', ['a1', 'a2']), equipe('e2', ['b1', 'b2'])];
    const { service, match } = cenario(teams);
    await service.chutarLetra('a1', 'm1', 'A', 'ATACAR', 'e2');
    await service.chutarLetra('b1', 'm1', 'R', 'ATACAR', 'e1');
    expect(match.jaAgiram).toEqual(['a1', 'b1']);
    expect(match.equipesFechadas).toEqual([]);
  });

  it('a letra não repete dentro da equipe, mas pode repetir entre equipes', async () => {
    const teams = [equipe('e1', ['a1', 'a2']), equipe('e2', ['b1', 'b2'])];
    const { service } = cenario(teams);
    await service.chutarLetra('a1', 'm1', 'A', 'DICA');
    await expect(
      service.chutarLetra('a2', 'm1', 'A', 'DICA'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.chutarLetra('b1', 'm1', 'A', 'DICA'),
    ).resolves.toBeDefined();
  });

  it('letra de rodada anterior é recusada para todos', async () => {
    const teams = [equipe('e1', ['a1']), equipe('e2', ['b1'])];
    const { service } = cenario(teams, {
      letrasTentadas: ['A'],
      mascara: ['A', '_', '_', '_'],
    });
    await expect(
      service.chutarLetra('b1', 'm1', 'A', 'DICA'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('o membro não age duas vezes na rodada', async () => {
    const teams = [equipe('e1', ['a1', 'a2']), equipe('e2', ['b1'])];
    const { service } = cenario(teams);
    await service.chutarLetra('a1', 'm1', 'A', 'DICA');
    await expect(service.chutarLetra('a1', 'm1', 'R', 'DICA')).rejects.toThrow(
      'Você já jogou nesta rodada.',
    );
  });

  it('a raiz pública nunca traz a letra nem o acerto: só quem já agiu', async () => {
    const teams = [equipe('e1', ['a1', 'a2']), equipe('e2', ['b1'])];
    const { service, rodada, transacoes } = cenario(teams);
    await service.chutarLetra('a1', 'm1', 'Q', 'DICA');
    const raiz = transacoes[0].raiz!;
    expect(raiz).not.toHaveProperty('acoesRodada');
    expect(JSON.stringify(raiz)).not.toContain('"Q"');
    expect(raiz.jaAgiram).toEqual(['a1']);
    expect(rodada().acoes).toEqual([
      expect.objectContaining({
        alunoId: 'a1',
        equipeId: 'e1',
        letra: 'Q',
        acertou: false,
      }),
    ]);
  });

  it('a máscara só muda no fechamento da rodada', async () => {
    const teams = [equipe('e1', ['a1']), equipe('e2', ['b1'])];
    const { service, match } = cenario(teams);
    await service.chutarLetra('a1', 'm1', 'A', 'DICA'); // e1 fecha
    expect(match.mascara).toEqual(['_', '_', '_', '_']);
    expect(match.equipesFechadas).toEqual([
      { equipeId: 'e1', ordem: 1, resultado: 'DICA' },
    ]);
    await service.chutarLetra('b1', 'm1', 'T', 'DICA'); // e2 fecha → rodada fecha
    expect(match.mascara).toEqual(['A', '_', 'T', '_']);
    expect(match.letrasTentadas).toEqual(['A', 'T']);
    expect(match.jaAgiram).toEqual([]);
    expect(match.equipesFechadas).toEqual([]);
  });
});

describe('Wor em paralelo — ordem de chegada (029 §1.2)', () => {
  it('quem fecha primeiro aplica o dano na hora', async () => {
    const teams = [equipe('e1', ['a1']), equipe('e2', ['b1', 'b2'])];
    const { service } = cenario(teams);
    await service.chutarLetra('a1', 'm1', 'A', 'ATACAR', 'e2');
    expect(teams[1].hp).toBe(WOR.HP_INICIAL - WOR.DANO_ATAQUE);
    expect(teams[0].pontos).toBe(WOR.DANO_ATAQUE * WOR.PONTOS_POR_DANO);
  });

  it('o reveal traz os resultados na ordem em que as equipes fecharam', async () => {
    const teams = [
      equipe('e1', ['a1']),
      equipe('e2', ['b1']),
      equipe('e3', ['c1']),
    ];
    const { service, match } = cenario(teams);
    await service.chutarLetra('b1', 'm1', 'A', 'ATACAR', 'e3');
    await service.chutarLetra('c1', 'm1', 'Z', 'ATACAR', 'e1');
    await service.chutarLetra('a1', 'm1', 'R', 'ATACAR', 'e2');
    const r = match.resumoRodada!;
    expect(r.seq).toBe(1);
    expect(r.resultados.map((x) => [x.equipeId, x.ordem, x.acao])).toEqual([
      ['e2', 1, 'ATACAR'],
      ['e3', 2, 'NADA'],
      ['e1', 3, 'ATACAR'],
    ]);
    expect(r.resultados[0].acertadores).toEqual([{ nome: 'B1', letra: 'A' }]);
  });

  it('castelo derrubado antes de fechar perde o ataque e fecha como CAIU', async () => {
    const teams = [
      equipe('e1', ['a1']),
      equipe('e2', ['b1', 'b2'], { hp: 100 }),
    ];
    const { service, match } = cenario(teams);
    await service.chutarLetra('b1', 'm1', 'R', 'ATACAR', 'e1'); // acertou, votou em e1
    await service.chutarLetra('a1', 'm1', 'A', 'ATACAR', 'e2'); // e1 fecha e derruba e2

    expect(teams[1].isHorde).toBe(true);
    expect(teams[0].hp).toBe(WOR.HP_INICIAL); // o ataque de e2 foi cancelado
    expect(match.lastGlobalAction?.tipo).toBe('QUEDA');
    // e2 fechou como CAIU → a rodada fechou com as letras das duas equipes.
    expect(
      match.resumoRodada!.resultados.map((r) => [r.equipeId, r.acao]),
    ).toEqual([
      ['e1', 'ATACAR'],
      ['e2', 'CAIU'],
    ]);
    expect(match.resumoRodada!.resultados[1].acertadores).toEqual([
      { nome: 'B1', letra: 'R' },
    ]);
    expect(match.mascara).toEqual(['A', 'R', '_', '_']);
  });

  it('o membro da equipe que caiu não joga mais na rodada (EQUIPE_FECHOU)', async () => {
    const teams = [
      equipe('e1', ['a1']),
      equipe('e2', ['b1', 'b2'], { hp: 100 }),
      equipe('e3', ['c1']),
    ];
    const { service } = cenario(teams);
    await service.chutarLetra('a1', 'm1', 'A', 'ATACAR', 'e2'); // derruba e2
    await expect(service.arriscar('b2', 'm1', 'xyz')).rejects.toMatchObject({
      response: { code: 'EQUIPE_FECHOU' },
    });
  });

  it('crítico: todos os membros acertam → 200; um erro → 100', async () => {
    const teams = [
      equipe('e1', ['a1', 'a2']),
      equipe('e2', ['b1', 'b2']),
      equipe('e3', ['c1']),
    ];
    const { service } = cenario(teams);
    await service.chutarLetra('a1', 'm1', 'A', 'ATACAR', 'e3');
    await service.chutarLetra('a2', 'm1', 'R', 'ATACAR', 'e3');
    expect(teams[2].hp).toBe(WOR.HP_INICIAL - WOR.DANO_CRITICO);
    await service.chutarLetra('b1', 'm1', 'T', 'ATACAR', 'e3');
    await service.chutarLetra('b2', 'm1', 'Z', 'ATACAR', 'e3');
    expect(teams[2].hp).toBe(
      WOR.HP_INICIAL - WOR.DANO_CRITICO - WOR.DANO_ATAQUE,
    );
  });

  it('votação: o rival mais votado entre quem acertou leva o dano', async () => {
    const teams = [
      equipe('e1', ['a1', 'a2', 'a3']),
      equipe('e2', ['b1']),
      equipe('e3', ['c1']),
    ];
    const { service } = cenario(teams);
    await service.chutarLetra('a1', 'm1', 'A', 'ATACAR', 'e2');
    await service.chutarLetra('a2', 'm1', 'R', 'ATACAR', 'e3');
    await service.chutarLetra('a3', 'm1', 'T', 'ATACAR', 'e3');
    expect(teams[2].hp).toBe(WOR.HP_INICIAL - WOR.DANO_CRITICO);
    expect(teams[1].hp).toBe(WOR.HP_INICIAL);
  });
});

describe('Wor em paralelo — fechamento da rodada (029 §1.3)', () => {
  let agora = Date.parse('2026-10-21T12:00:00.000Z');
  beforeEach(() => {
    agora = Date.parse('2026-10-21T12:00:00.000Z');
    jest.spyOn(Date, 'now').mockImplementation(() => agora);
  });
  afterEach(() => jest.restoreAllMocks());

  it('por tempo: as equipes abertas resolvem na ordem da última ação', async () => {
    const teams = [equipe('e1', ['a1', 'a2']), equipe('e2', ['b1', 'b2'])];
    const { service, match } = cenario(teams);
    agora += 5_000;
    await service.chutarLetra('b1', 'm1', 'A', 'ATACAR', 'e1');
    agora += 5_000;
    await service.chutarLetra('a1', 'm1', 'R', 'ATACAR', 'e2');

    agora += LIMITE_RODADA_MS;
    await service.resolverPorTempo('p1', 'm1');
    const r = match.resumoRodada!;
    expect(r.porTempo).toBe(true);
    expect(r.resultados.map((x) => [x.equipeId, x.ordem])).toEqual([
      ['e2', 1],
      ['e1', 2],
    ]);
    expect(teams[0].hp).toBe(WOR.HP_INICIAL - WOR.DANO_ATAQUE);
    expect(teams[1].hp).toBe(WOR.HP_INICIAL - WOR.DANO_ATAQUE);
    expect(match.rodadaIniciadaEm).toBe(new Date(agora).toISOString());
  });

  it('por tempo: equipe sem nenhuma ação não age', async () => {
    const teams = [equipe('e1', ['a1', 'a2']), equipe('e2', ['b1'])];
    const { service, match } = cenario(teams);
    await service.chutarLetra('a1', 'm1', 'A', 'ATACAR', 'e2');
    agora += LIMITE_RODADA_MS;
    await service.resolverPorTempo('p1', 'm1');
    expect(match.resumoRodada!.resultados.map((x) => x.equipeId)).toEqual([
      'e1',
    ]);
  });

  it('antes do prazo o /tempo não fecha nada', async () => {
    const teams = [equipe('e1', ['a1', 'a2']), equipe('e2', ['b1'])];
    const { service, match } = cenario(teams);
    await service.chutarLetra('a1', 'm1', 'A', 'DICA');
    agora += 30_000;
    await service.resolverPorTempo('p1', 'm1');
    expect(match.resumoRodada).toBeUndefined();
    expect(match.jaAgiram).toEqual(['a1']);
  });

  it('duas compras de dica na mesma rodada revelam duas cartas', async () => {
    const teams = [equipe('e1', ['a1']), equipe('e2', ['b1'])];
    const { service, match } = cenario(teams);
    await service.chutarLetra('a1', 'm1', 'A', 'DICA');
    expect(match.cartasVisiveis).toEqual(['d1']); // só no fechamento
    await service.chutarLetra('b1', 'm1', 'R', 'DICA');
    expect(match.cartasVisiveis).toEqual(['d1', 'd2', 'd3']);
  });

  it('as cartas não passam do total', async () => {
    const teams = [equipe('e1', ['a1']), equipe('e2', ['b1'])];
    const { service, match } = cenario(teams, { cartasVisiveis: ['d1', 'd2'] });
    await service.chutarLetra('a1', 'm1', 'A', 'DICA');
    await service.chutarLetra('b1', 'm1', 'R', 'DICA');
    expect(match.cartasVisiveis).toEqual(['d1', 'd2', 'd3']);
  });

  it('palavra completa no fechamento avança a onda', async () => {
    const teams = [equipe('e1', ['a1', 'a2']), equipe('e2', ['b1', 'b2'])];
    const { service, match } = cenario(teams);
    await service.chutarLetra('a1', 'm1', 'A', 'DICA');
    await service.chutarLetra('a2', 'm1', 'R', 'DICA');
    await service.chutarLetra('b1', 'm1', 'T', 'DICA');
    await service.chutarLetra('b2', 'm1', 'E', 'DICA');
    expect(match.ondaIndex).toBe(1);
    expect(match.mascara).toEqual(['_', '_', '_']);
    expect(match.cartasVisiveis).toEqual(['x1']);
    expect(match.letrasTentadas).toEqual([]);
  });

  it('completar a última onda encerra com o vencedor de maior HP', async () => {
    const teams = [
      equipe('e1', ['a1'], { hp: 700 }),
      equipe('e2', ['b1'], { hp: 900 }),
    ];
    const { service, match } = cenario(teams, ultimaOnda);
    await service.chutarLetra('a1', 'm1', 'I', 'DICA');
    await service.chutarLetra('b1', 'm1', 'Z', 'DICA');
    expect(match.status).toBe('ENCERRADO');
    expect(match.vencedorEquipeId).toBe('e2');
    expect(match.rodadaIniciadaEm).toBeNull();
  });
});

describe('Wor em paralelo — Risco Heroico e Invasão (029 §1.4)', () => {
  it('acerto: cura, bônus e a onda acaba para todos; o dano de quem já fechou fica', async () => {
    const teams = [
      equipe('e1', ['a1']),
      equipe('e2', ['b1', 'b2'], { hp: 500 }),
      equipe('e3', ['c1', 'c2']),
    ];
    const { service, match, rodada } = cenario(teams);
    await service.chutarLetra('a1', 'm1', 'A', 'ATACAR', 'e3'); // e1 fecha: 100 em e3
    await service.chutarLetra('c1', 'm1', 'R', 'ATACAR', 'e1'); // pendente
    await service.arriscar('b1', 'm1', 'arte');

    expect(teams[1].hp).toBe(500 + WOR.CURA_MASSIVA);
    expect(teams[1].pontos).toBe(WOR.BONUS_ARRISCAR);
    expect(teams[2].hp).toBe(WOR.HP_INICIAL - WOR.DANO_ATAQUE);
    expect(teams[0].hp).toBe(WOR.HP_INICIAL); // ataque pendente de e3 descartado
    expect(match.ondaIndex).toBe(1);
    expect(match.lastGlobalAction?.tipo).toBe('CURA');
    expect(match.jaAgiram).toEqual([]);
    expect(rodada().acoes).toEqual([]);
  });

  it('a onda nova nasce congelada pelo card (3s no futuro)', async () => {
    jest
      .spyOn(Date, 'now')
      .mockReturnValue(Date.parse('2026-10-21T12:00:00.000Z'));
    const teams = [equipe('e1', ['a1']), equipe('e2', ['b1'])];
    const { service, match } = cenario(teams);
    await service.arriscar('a1', 'm1', 'arte');
    expect(match.rodadaIniciadaEm).toBe('2026-10-21T12:00:03.000Z');
    jest.restoreAllMocks();
  });

  it('erro: Dano Crítico no próprio castelo vai para o feed, sem card nem freeze', async () => {
    const teams = [equipe('e1', ['a1', 'a2']), equipe('e2', ['b1'])];
    const { service, match } = cenario(teams);
    const inicio = match.rodadaIniciadaEm;
    await service.arriscar('a1', 'm1', 'rainha');
    expect(teams[0].hp).toBe(WOR.HP_INICIAL - WOR.DANO_CRITICO);
    expect(match.lastGlobalAction).toBeUndefined();
    expect(match.rodadaIniciadaEm).toBe(inicio);
    expect(match.feedRodada).toEqual([
      expect.objectContaining({ tipo: 'DANO_CRITICO', seq: 1 }),
    ]);
    expect(match.jaAgiram).toEqual(['a1']);
  });

  it('erro que derruba o castelo: card de Queda e a equipe fecha como CAIU', async () => {
    const teams = [
      equipe('e1', ['a1', 'a2'], { hp: 200 }),
      equipe('e2', ['b1', 'b2']),
    ];
    const { service, match } = cenario(teams);
    await service.arriscar('a1', 'm1', 'rainha');
    expect(teams[0].isHorde).toBe(true);
    expect(match.lastGlobalAction?.tipo).toBe('QUEDA');
    expect(match.equipesFechadas).toEqual([
      { equipeId: 'e1', ordem: 1, resultado: 'CAIU' },
    ]);
  });

  it('a Horda não chuta letra, só tenta a Invasão', async () => {
    const teams = [
      equipe('e1', ['a1'], { hp: 0, isHorde: true }),
      equipe('e2', ['b1']),
    ];
    const { service } = cenario(teams);
    await expect(
      service.chutarLetra('a1', 'm1', 'A', 'DICA'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('Invasão certa: a Horda rouba o castelo do líder, que vira Horda', async () => {
    const teams = [
      equipe('e1', ['a1'], { hp: 0, isHorde: true }),
      equipe('e2', ['b1'], { hp: 800 }),
      equipe('e3', ['c1'], { hp: 600 }),
    ];
    const { service, match } = cenario(teams);
    await service.arriscar('a1', 'm1', 'arte');
    expect(teams[0]).toMatchObject({ hp: 800, isHorde: false });
    expect(teams[1]).toMatchObject({ hp: 0, isHorde: true });
    expect(match.lastGlobalAction?.tipo).toBe('USURPACAO');
  });

  it('Invasão errada: feed, e a Horda fecha a rodada sem atacar', async () => {
    const teams = [
      equipe('e1', ['a1'], { hp: 0, isHorde: true }),
      equipe('e2', ['b1', 'b2']),
    ];
    const { service, match } = cenario(teams);
    await service.arriscar('a1', 'm1', 'xyz');
    expect(match.feedRodada[0].mensagem).toBe('A1 tentou a Invasão e errou!');
    expect(match.equipesFechadas).toEqual([
      { equipeId: 'e1', ordem: 1, resultado: 'NADA' },
    ]);
  });

  it('o mestre pula a palavra: a rodada em curso é descartada', async () => {
    const teams = [equipe('e1', ['a1']), equipe('e2', ['b1', 'b2'])];
    const { service, match, rodada } = cenario(teams);
    await service.chutarLetra('b1', 'm1', 'A', 'ATACAR', 'e1');
    await service.pularPalavra('p1', 'm1');
    expect(match.ondaIndex).toBe(1);
    expect(match.jaAgiram).toEqual([]);
    expect(rodada().acoes).toEqual([]);
    expect(teams[0].hp).toBe(WOR.HP_INICIAL);
  });
});

describe('Wor em paralelo — feed e cards (029 §3, §4)', () => {
  beforeEach(() =>
    jest
      .spyOn(Date, 'now')
      .mockReturnValue(Date.parse('2026-10-21T12:00:00.000Z')),
  );
  afterEach(() => jest.restoreAllMocks());

  it('ataque vai para o feed sem congelar o relógio', async () => {
    const teams = [equipe('e1', ['a1']), equipe('e2', ['b1'])];
    const { service, match } = cenario(teams);
    const inicio = match.rodadaIniciadaEm;
    await service.chutarLetra('a1', 'm1', 'A', 'ATACAR', 'e2');
    expect(match.lastGlobalAction).toBeUndefined();
    expect(match.rodadaIniciadaEm).toBe(inicio);
    expect(match.feedRodada).toEqual([
      expect.objectContaining({
        tipo: 'ATAQUE',
        mensagem: 'A e1 fechou em 1º e causou 100 de dano no castelo da e2!',
      }),
    ]);
  });

  it('compra de dica vai para o feed', async () => {
    const teams = [equipe('e1', ['a1']), equipe('e2', ['b1'])];
    const { service, match } = cenario(teams);
    await service.chutarLetra('a1', 'm1', 'A', 'DICA');
    expect(match.feedRodada[0]).toMatchObject({ tipo: 'DICA' });
  });

  it('o feed zera na rodada nova, mas o seq continua', async () => {
    const teams = [equipe('e1', ['a1']), equipe('e2', ['b1'])];
    const { service, match } = cenario(teams);
    await service.chutarLetra('a1', 'm1', 'A', 'DICA');
    await service.chutarLetra('b1', 'm1', 'R', 'DICA');
    expect(match.feedRodada).toEqual([]);
    expect(match.feedSeq).toBe(2);
  });

  it('a queda congela: a rodada em curso ganha 3s, e o card chega a todas as equipes', async () => {
    const teams = [
      equipe('e1', ['a1']),
      equipe('e2', ['b1'], { hp: 100 }),
      equipe('e3', ['c1']),
    ];
    const { service, match } = cenario(teams);
    await service.chutarLetra('a1', 'm1', 'A', 'ATACAR', 'e2');
    expect(match.lastGlobalAction).toMatchObject({
      tipo: 'QUEDA',
      seq: 1,
      mensagem: 'O castelo da e2 caiu! A e2 agora é uma Horda.',
    });
    expect(match.rodadaIniciadaEm).toBe('2026-10-21T12:00:03.000Z');
    for (const t of teams) expect(t.lastGlobalAction?.seq).toBe(1);
  });

  it('o placar da raiz reflete o HP novo', async () => {
    const teams = [equipe('e1', ['a1']), equipe('e2', ['b1'])];
    const { service, match } = cenario(teams);
    await service.chutarLetra('a1', 'm1', 'A', 'ATACAR', 'e2');
    expect(match.placar.find((p) => p.id === 'e2')?.hp).toBe(900);
  });
});

describe('Wor em paralelo — pontos, ranking e log', () => {
  it('arriscar e acertar rende o bônus de arriscar à equipe', async () => {
    const teams = [equipe('e1', ['a1'], { hp: 500 }), equipe('e2', ['b1'])];
    const { service } = cenario(teams);
    await service.arriscar('a1', 'm1', 'arte');
    expect(teams[0].pontos).toBe(WOR.BONUS_ARRISCAR);
  });

  it('desempate: HP igual → vence quem tem mais pontos', async () => {
    const teams = [equipe('e1', ['a1'], { pontos: 500 }), equipe('e2', ['b1'])];
    const { service, match } = cenario(teams, ultimaOnda);
    await service.chutarLetra('a1', 'm1', 'I', 'DICA');
    await service.chutarLetra('b1', 'm1', 'Z', 'DICA');
    expect(match.vencedorEquipeId).toBe('e1');
  });

  it('ranking: campeã credita cheio; demais, metade (motivo WOR)', async () => {
    const teams = [
      equipe('e1', ['a1'], { pontos: 1000 }),
      equipe('e2', ['b1'], { hp: 500, pontos: 400 }),
    ];
    const { service, creditos } = cenario(teams, ultimaOnda);
    await service.chutarLetra('a1', 'm1', 'I', 'DICA');
    await service.chutarLetra('b1', 'm1', 'Z', 'DICA');
    expect(creditos).toHaveLength(1);
    expect(creditos[0].motivo).toBe('WOR');
    expect(creditos[0].pontos).toEqual([
      { alunoId: 'a1', pontos: 2000 },
      { alunoId: 'b1', pontos: 450 },
    ]);
  });

  it('partida casual: placar e vencedor normais, sem crédito', async () => {
    const teams = [
      equipe('e1', ['a1'], { pontos: 1000 }),
      equipe('e2', ['b1'], { hp: 500 }),
    ];
    const { service, match, creditos } = cenario(teams, {
      ...ultimaOnda,
      valeRanking: false,
    });
    await service.chutarLetra('a1', 'm1', 'I', 'DICA');
    await service.chutarLetra('b1', 'm1', 'Z', 'DICA');
    expect(match.vencedorEquipeId).toBe('e1');
    expect(teams[0].pontos).toBe(2000);
    expect(creditos).toHaveLength(0);
    expect(
      match.logPontuacao!.find((l) => l.alunoId === 'a1')!.creditoRanking,
    ).toBe(0);
  });

  it('o log da equipe registra o dano com a ordem e o multiplicador', async () => {
    const teams = [equipe('e1', ['a1', 'a2']), equipe('e2', ['b1'])];
    const { service } = cenario(teams, { multiplicador: 2 });
    await service.chutarLetra('a1', 'm1', 'A', 'ATACAR', 'e2');
    await service.chutarLetra('a2', 'm1', 'R', 'ATACAR', 'e2');
    const item = teams[0].logPontos[0];
    expect(item).toMatchObject({ fonte: 'CRITICO', pontos: 400, rodada: 1 });
    expect(item.descricao).toBe(
      'Rodada 1: a equipe fechou em 1º, acertou 2 letras (A1, A2) e deu um ataque crítico no castelo da e2, 200 de dano (×2)',
    );
  });

  it('no fim: HP_FINAL, fator ×0,5 da não campeã e soma igual ao crédito', async () => {
    const teams = [
      equipe('e1', ['a1']),
      equipe('e2', ['b1', 'b2'], {
        hp: 500,
        pontos: 401,
        logPontos: [{ rodada: 1, fonte: 'DANO', descricao: 'x', pontos: 401 }],
      }),
    ];
    const { service, match, creditos } = cenario(teams, ultimaOnda);
    await service.chutarLetra('a1', 'm1', 'I', 'DICA');
    await service.chutarLetra('b1', 'm1', 'Z', 'DICA');
    await service.chutarLetra('b2', 'm1', 'Y', 'DICA');
    const log = match.logPontuacao!;
    const b1 = log.find((l) => l.alunoId === 'b1')!;
    expect(b1.itens.map((i) => i.fonte)).toEqual([
      'DANO',
      'HP_FINAL',
      'FATOR_COLOCACAO',
    ]);
    expect(b1.totalPartida).toBe(901);
    const credito = creditos[0].pontos.find((c) => c.alunoId === 'b1')!.pontos;
    expect(b1.creditoRanking).toBe(credito);
    expect(b1.itens.reduce((s, i) => s + i.pontos, 0)).toBe(credito);
  });

  it('multiplicador: dano e bônus de arriscar multiplicados; o dano no castelo não', async () => {
    const teams = [equipe('e1', ['a1']), equipe('e2', ['b1'])];
    const { service } = cenario(teams, { multiplicador: 3 });
    await service.chutarLetra('a1', 'm1', 'A', 'ATACAR', 'e2');
    expect(teams[0].pontos).toBe(300);
    expect(teams[1].hp).toBe(900);
    await service.arriscar('b1', 'm1', 'arte');
    expect(teams[1].pontos).toBe(WOR.BONUS_ARRISCAR * 3);
  });

  it('partida antiga sem multiplicador vale 1x', async () => {
    const teams = [equipe('e1', ['a1']), equipe('e2', ['b1'])];
    const { service, match } = cenario(teams);
    delete (match as Partial<WorMatchEntity>).multiplicador;
    await service.chutarLetra('a1', 'm1', 'A', 'ATACAR', 'e2');
    expect(teams[0].pontos).toBe(WOR.DANO_ATAQUE);
  });
});

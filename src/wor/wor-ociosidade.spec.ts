import { BadRequestException, ConflictException } from '@nestjs/common';
import { WorMatchEntity } from './entities/wor-match.entity';
import { WorTeamEntity } from './entities/wor-team.entity';
import { equipe, fakeWor, JOGO_TESTE, partidaTeste } from './wor.fake';
import { WorMatchService } from './wor-match.service';
import { WorMatchRepository } from './wor-match.repository';
import { XpService } from '../turma/xp.service';

/**
 * Spec 032 §3 — ociosidade no Wor. Falta = rodada que fecha sem o aluno ter
 * chutado letra nem arriscado. Contagem total; a partir do limite (padrão 2)
 * ele é marcado. Quando só faltam ociosos, a rodada fecha sem esperar o tempo.
 */
function cenario(teams: WorTeamEntity[], over: Partial<WorMatchEntity> = {}) {
  return fakeWor(JOGO_TESTE, partidaTeste(teams, over), teams);
}

describe('Wor 032 — faltas por rodada', () => {
  beforeEach(() => {
    let agora = Date.parse('2026-11-04T12:00:00.000Z');
    jest.spyOn(Date, 'now').mockImplementation(() => (agora += 61_000));
  });
  afterEach(() => jest.restoreAllMocks());

  it('quem não agiu na rodada fechada por tempo ganha uma falta', async () => {
    const teams = [equipe('e1', ['a1', 'a2']), equipe('e2', ['b1'])];
    const { service, match } = cenario(teams);
    await service.chutarLetra('a1', 'm1', 'Q', 'DICA');
    await service.resolverPorTempo('p1', 'm1');
    expect(match.ociosidade).toEqual({ a2: 1, b1: 1 });
  });

  it('a contagem é total na partida, não precisa ser seguida', async () => {
    const teams = [equipe('e1', ['a1']), equipe('e2', ['b1'])];
    const { service, match } = cenario(teams);
    await service.resolverPorTempo('p1', 'm1'); // a1, b1 faltam
    await service.chutarLetra('b1', 'm1', 'Q', 'DICA');
    await service.chutarLetra('a1', 'm1', 'Z', 'DICA'); // rodada fecha cheia
    await service.chutarLetra('a1', 'm1', 'Y', 'DICA');
    await service.resolverPorTempo('p1', 'm1'); // b1 falta de novo
    expect(match.ociosidade).toEqual({ a1: 1, b1: 2 });
  });

  it('na Horda, depois do arriscar ninguém mais tinha ação: sem falta', async () => {
    const teams = [
      equipe('e1', ['a1', 'a2']),
      equipe('h', ['h1', 'h2'], { hp: 0, isHorde: true }),
    ];
    const { service, match } = cenario(teams);
    await service.arriscar('h1', 'm1', 'xyz');
    await service.chutarLetra('a1', 'm1', 'Q', 'DICA');
    await service.resolverPorTempo('p1', 'm1');
    expect(match.ociosidade).toEqual({ a2: 1 });
  });

  it('pular a palavra não conta falta', async () => {
    const teams = [equipe('e1', ['a1']), equipe('e2', ['b1'])];
    const { service, match } = cenario(teams);
    await service.pularPalavra('p1', 'm1');
    expect(match.ociosidade ?? {}).toEqual({});
  });
});

describe('Wor 032 — rodada fecha cedo se só faltam ociosos', () => {
  it('o último não ocioso a jogar fecha a rodada', async () => {
    const teams = [equipe('e1', ['a1', 'a2']), equipe('e2', ['b1'])];
    const { service, match } = cenario(teams, { ociosidade: { a2: 2 } });
    await service.chutarLetra('a1', 'm1', 'Q', 'DICA');
    expect(match.resumoRodada).toBeUndefined();
    await service.chutarLetra('b1', 'm1', 'Z', 'DICA');
    expect(match.resumoRodada?.seq).toBe(1);
    expect(match.ociosidade).toEqual({ a2: 3 });
  });

  it('abaixo do limite, espera o colega', async () => {
    const teams = [equipe('e1', ['a1', 'a2']), equipe('e2', ['b1'])];
    const { service, match } = cenario(teams, { ociosidade: { a2: 1 } });
    await service.chutarLetra('a1', 'm1', 'Q', 'DICA');
    await service.chutarLetra('b1', 'm1', 'Z', 'DICA');
    expect(match.resumoRodada).toBeUndefined();
  });

  it('respeita o limite escolhido no lobby', async () => {
    const teams = [equipe('e1', ['a1', 'a2']), equipe('e2', ['b1'])];
    const { service, match } = cenario(teams, {
      ociosidade: { a2: 2 },
      limiteOciosidade: 3,
    });
    await service.chutarLetra('a1', 'm1', 'Q', 'DICA');
    await service.chutarLetra('b1', 'm1', 'Z', 'DICA');
    expect(match.resumoRodada).toBeUndefined();
  });
});

describe('Wor 032 — fim da partida', () => {
  const ultimaOnda: Partial<WorMatchEntity> = {
    ondaIndex: 1,
    mascara: ['R', 'E', '_'],
    letrasTentadas: ['R', 'E'],
    cartasVisiveis: ['x1'],
    totalCartas: 1,
  };

  it('o log final traz as faltas e marca o ocioso', async () => {
    const teams = [equipe('e1', ['a1', 'a2']), equipe('e2', ['b1'])];
    const { service, match } = cenario(teams, {
      ...ultimaOnda,
      ociosidade: { a2: 2, b1: 1 },
    });
    await service.chutarLetra('a1', 'm1', 'I', 'DICA');
    await service.chutarLetra('b1', 'm1', 'Z', 'DICA'); // a2 ocioso: fecha e encerra
    expect(match.status).toBe('ENCERRADO');
    const de = (id: string) => match.logPontuacao!.find((l) => l.alunoId === id)!;
    expect(de('a2')).toMatchObject({ faltasOciosidade: 3, ocioso: true });
    expect(de('b1')).toMatchObject({ faltasOciosidade: 1, ocioso: false });
    expect(de('a1')).not.toHaveProperty('ocioso');
  });
});

describe('Wor 032 — lobby e desconto', () => {
  it('limite só no lobby (WorMatchService)', async () => {
    const m = new WorMatchEntity({ id: 'm1', professorId: 'p1', status: 'LOBBY' });
    const matches = {
      buscar: async () => m,
      listarTeams: async () => [],
      atualizar: async (_id: string, d: Partial<WorMatchEntity>) => {
        Object.assign(m, d);
      },
    } as unknown as WorMatchRepository;
    const service = new WorMatchService(
      {} as never,
      matches,
      {} as never,
      {} as never,
    );
    await service.definirLimiteOciosidade('p1', 'm1', 4);
    expect(m.limiteOciosidade).toBe(4);
    m.status = 'EM_ANDAMENTO';
    await expect(service.definirLimiteOciosidade('p1', 'm1', 3)).rejects.toThrow(BadRequestException);
  });

  it('desconta o ocioso uma vez, com o que de fato saiu, e registra no log', async () => {
    const m = new WorMatchEntity({
      id: 'm1',
      professorId: 'p1',
      status: 'ENCERRADO',
      turmaId: 't1',
      logPontuacao: [
        { alunoId: 'a2', nome: 'A2', totalPartida: 800, creditoRanking: 800, itens: [], faltasOciosidade: 3, ocioso: true },
      ],
    });
    const debitos: Array<[string, number, string]> = [];
    const xp = {
      penalizarJogo: async (_t: string, alunoId: string, pontos: number, motivo: string) => {
        debitos.push([alunoId, pontos, motivo]);
        return Math.min(pontos, 300);
      },
    } as unknown as XpService;
    const { service } = fakeWor(JOGO_TESTE, m, [], { xp });
    await service.descontarOciosidade('p1', 'm1', { alunoId: 'a2', modo: 'ZERAR_PARTIDA' });
    expect(debitos).toEqual([['a2', 800, 'WOR_OCIOSIDADE']]);
    expect(m.descontosOciosidade).toEqual({ a2: 300 });
    expect(m.logPontuacao![0].creditoRanking).toBe(500);
    await expect(
      service.descontarOciosidade('p1', 'm1', { alunoId: 'a2', modo: 'ZERAR_PARTIDA' }),
    ).rejects.toThrow(ConflictException);
  });
});

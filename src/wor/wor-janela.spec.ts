import { BadRequestException } from '@nestjs/common';
import {
  JANELA_ANIMACAO,
  LIMITE_RODADA_MS,
  ResumoRodada,
  WOR,
  eventosDaRodada,
  janelaAnimacao,
} from './entities/wor-match.entity';
import { WorTeamEntity } from './entities/wor-team.entity';
import { fakeWor, JOGO_TESTE, partidaTeste } from './wor.fake';

/**
 * Spec 035 §2 — a próxima rodada espera a animação do fechamento. O servidor
 * grava `rodadaIniciadaEm` no futuro (janela pela quantidade de eventos) e
 * recusa as jogadas antes dela com `RODADA_NAO_COMECOU`. A palavra é ARTE.
 */
const time = (
  id: string,
  membros: string[],
  hp: number = WOR.HP_INICIAL,
  isHorde = false,
) =>
  new WorTeamEntity({
    id,
    nome: id.toUpperCase(),
    hp,
    isHorde,
    membros: membros.map((a) => ({ alunoId: a, nome: a.toUpperCase() })),
  });

const resumo = (over: Partial<ResumoRodada> = {}): ResumoRodada => ({
  seq: 1,
  resultados: [],
  ...over,
});

describe('Wor 035 — conta da janela', () => {
  it('constantes: 2,5s de base, 1,2s por evento, teto de 12s', () => {
    expect(JANELA_ANIMACAO).toEqual({
      BASE_MS: 2500,
      POR_EVENTO_MS: 1200,
      MAX_MS: 12000,
    });
  });

  it('conta ataques, arriscar (acerto ou erro) e quedas', () => {
    const r = resumo({
      resultados: [
        {
          equipeId: 'e1',
          equipeNome: 'E1',
          ordem: 1,
          acertadores: [],
          acao: 'ATACAR',
          alvoEquipeId: 'e2',
          dano: 100,
        },
        {
          equipeId: 'e2',
          equipeNome: 'E2',
          ordem: 2,
          acertadores: [],
          acao: 'DICA',
          arriscar: { nome: 'B1', acertou: false },
        },
        {
          equipeId: 'e3',
          equipeNome: 'E3',
          ordem: 3,
          acertadores: [],
          acao: 'NADA',
        },
      ],
      quedas: ['e2'],
    });
    expect(eventosDaRodada(r)).toBe(3);
    expect(janelaAnimacao(r)).toBe(2500 + 3 * 1200);
  });

  it('rodada sem eventos: só a base; muitos eventos: o teto', () => {
    expect(janelaAnimacao(resumo())).toBe(2500);
    const muitos = resumo({
      resultados: Array.from({ length: 10 }, (_, i) => ({
        equipeId: `e${i}`,
        equipeNome: `E${i}`,
        ordem: i + 1,
        acertadores: [],
        acao: 'ATACAR' as const,
        alvoEquipeId: 'x',
        dano: 100,
      })),
    });
    expect(janelaAnimacao(muitos)).toBe(12000);
  });
});

describe('Wor 035 — rodada nova no futuro', () => {
  it('o fechamento grava rodadaIniciadaEm = agora + janela e as quedas', async () => {
    const teams = [time('e1', ['a1']), time('e2', ['b1'], 100)];
    const { service, match } = fakeWor(JOGO_TESTE, partidaTeste(teams), teams);
    const antes = Date.now();
    await service.chutarLetra('a1', 'm1', 'A', 'ATACAR', 'e2');
    await service.chutarLetra('b1', 'm1', 'X', 'DICA');

    expect(match.resumoRodada?.quedas).toEqual(['e2']);
    // ataque + queda = 2 eventos; o card de QUEDA (3s) cabe dentro da janela
    const janela = 2500 + 2 * 1200;
    const inicio = Date.parse(match.rodadaIniciadaEm!);
    expect(inicio - antes).toBeGreaterThanOrEqual(janela - 50);
    expect(inicio - antes).toBeLessThanOrEqual(janela + 1000);
  });

  it('jogada antes de a rodada começar: 400 RODADA_NAO_COMECOU', async () => {
    const teams = [time('e1', ['a1']), time('e2', ['b1'])];
    const { service } = fakeWor(
      JOGO_TESTE,
      partidaTeste(teams, {
        rodadaIniciadaEm: new Date(Date.now() + 5000).toISOString(),
      }),
      teams,
    );
    for (const jogada of [
      () => service.chutarLetra('a1', 'm1', 'A', 'ATACAR', 'e2'),
      () => service.arriscar('b1', 'm1', 'ARTE'),
    ]) {
      const erro = await jogada().catch((e: unknown) => e);
      expect(erro).toBeInstanceOf(BadRequestException);
      expect((erro as BadRequestException).getResponse()).toMatchObject({
        code: 'RODADA_NAO_COMECOU',
      });
    }
  });

  it('o /tempo só fecha depois da janela + 60s', async () => {
    const teams = [time('e1', ['a1']), time('e2', ['b1'])];
    const inicio = Date.now() - LIMITE_RODADA_MS + 5000; // janela ainda a correr
    const { service, match } = fakeWor(
      JOGO_TESTE,
      partidaTeste(teams, {
        rodadaIniciadaEm: new Date(inicio + 10_000).toISOString(),
      }),
      teams,
    );
    await service.resolverPorTempo('p1', 'm1');
    expect(match.resumoRodada).toBeFalsy();
  });

  it('retomar a pausa empurra também a rodada que ainda não começou', async () => {
    const teams = [time('e1', ['a1']), time('e2', ['b1'])];
    const futuro = Date.now() + 5000;
    const { service, match } = fakeWor(
      JOGO_TESTE,
      partidaTeste(teams, {
        rodadaIniciadaEm: new Date(futuro).toISOString(),
        pausadaEm: new Date(Date.now() - 4000).toISOString(),
      }),
      teams,
    );
    await service.retomar('p1', 'm1');
    expect(Date.parse(match.rodadaIniciadaEm!)).toBeGreaterThanOrEqual(
      futuro + 3900,
    );
  });
});

describe('Wor 035 — dono de cada reino (reinos)', () => {
  it('a Usurpação troca o reino do líder com o da Horda', async () => {
    const teams = [
      time('e1', ['a1'], 800),
      time('e2', ['b1'], 900),
      time('h', ['h1'], 0, true),
    ];
    const { service, match } = fakeWor(
      JOGO_TESTE,
      partidaTeste(teams, { reinos: { e1: 0, e2: 1, h: 2 } }),
      teams,
    );
    await service.chutarLetra('a1', 'm1', 'Q', 'DICA');
    await service.chutarLetra('b1', 'm1', 'Q', 'DICA');
    await service.arriscar('h1', 'm1', 'arte');

    expect(match.reinos).toEqual({ e1: 0, e2: 2, h: 1 });
    const usurpacao = match.resumoRodada!.resultados.find(
      (r) => r.equipeId === 'h',
    )!.arriscar;
    expect(usurpacao).toMatchObject({
      efeito: 'USURPACAO',
      alvoEquipeId: 'e2',
    });
  });

  it('partida sem o campo continua sem ele (a tela usa ordemEquipes)', async () => {
    const teams = [time('e1', ['a1'], 800), time('h', ['h1'], 0, true)];
    const { service, match } = fakeWor(JOGO_TESTE, partidaTeste(teams), teams);
    await service.chutarLetra('a1', 'm1', 'Q', 'DICA');
    await service.arriscar('h1', 'm1', 'arte');
    expect(match.reinos).toBeUndefined();
    expect(teams.find((t) => t.id === 'h')!.isHorde).toBe(false);
  });
});

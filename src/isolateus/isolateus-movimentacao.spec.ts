import { BadRequestException, HttpException } from '@nestjs/common';
import { ISOLATEUS } from './entities/isolateus-match.entity';
import { reescalarAgenda, sortearAgendaNpc } from './isolateus-deslocamento';
import { vilaComAmeacas } from './isolateus-vila.fixture-spec';
import { vizinhosDe } from './isolateus.data';

/**
 * 026 — Movimentação em tempo real. Os avisos de saída da noite
 * (`deslocamentosNoite`), a agenda dos NPCs e as saídas e chegadas do amanhecer
 * (`ultimosDeslocamentos`).
 */

const codigo = (e: unknown) =>
  ((e as HttpException).getResponse() as { code?: string }).code;

/** Relógio controlado: o rate limit e a agenda dependem de `Date`. */
let agora = Date.parse('2026-10-07T12:00:00.000Z');
const avancar = (ms: number) => {
  agora += ms;
  jest.setSystemTime(agora);
};
beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  agora = Date.parse('2026-10-07T12:00:00.000Z');
  jest.setSystemTime(agora);
});
afterEach(() => jest.useRealTimers());

describe('Isolateus 026 — mover publica o aviso de saída (Task 2)', () => {
  it('grava o aviso no doc público e o destino no cofre, no MESMO commit', async () => {
    const ctx = vilaComAmeacas();
    await ctx.service.mover('a3', 'p1', 'energia');

    expect(ctx.partida.deslocamentosNoite).toEqual([
      { habitanteId: 'h3', para: 'energia' },
    ]);
    expect(ctx.segredo.posicoesNoite).toEqual([
      { habitanteId: 'h3', setorId: 'energia' },
    ]);
    const commit = (ctx.repo.commitPartida as jest.Mock).mock.calls.find(
      ([, pub]) => pub && 'deslocamentosNoite' in pub,
    );
    expect(commit?.[2]).toHaveProperty('posicoesNoite');
    // A posição pública só muda no amanhecer.
    expect(ctx.setorDe('h3')).toBe('seguranca');
  });

  it('trocar de destino substitui o aviso', async () => {
    const ctx = vilaComAmeacas();
    await ctx.service.mover('a3', 'p1', 'energia');
    avancar(1_000);
    await ctx.service.mover('a3', 'p1', 'comercio');
    expect(ctx.partida.deslocamentosNoite).toEqual([
      { habitanteId: 'h3', para: 'comercio' },
    ]);
  });

  it('voltar à origem remove o aviso', async () => {
    const ctx = vilaComAmeacas();
    await ctx.service.mover('a3', 'p1', 'energia');
    avancar(1_000);
    await ctx.service.mover('a3', 'p1', 'seguranca');
    expect(ctx.partida.deslocamentosNoite).toEqual([]);
    expect(ctx.segredo.posicoesNoite).toEqual([]);
  });

  it('confirmar-posicao só confirma: não desfaz um deslocamento já feito', async () => {
    const ctx = vilaComAmeacas();
    await ctx.service.mover('a3', 'p1', 'energia');
    await ctx.service.confirmarPosicao('a3', 'p1');
    expect(ctx.partida.deslocamentosNoite).toEqual([
      { habitanteId: 'h3', para: 'energia' },
    ]);
    expect((await ctx.service.painel('a3', 'p1')).setorId).toBe('energia');
  });

  it('429 MOVER_RAPIDO abaixo de 1s entre duas trocas', async () => {
    const ctx = vilaComAmeacas();
    await ctx.service.mover('a3', 'p1', 'energia');
    avancar(500);
    const e = await ctx.service.mover('a3', 'p1', 'comercio').catch((x) => x);
    expect(e).toBeInstanceOf(HttpException);
    expect((e as HttpException).getStatus()).toBe(429);
    expect(codigo(e)).toBe('MOVER_RAPIDO');
    expect(ctx.partida.deslocamentosNoite).toEqual([
      { habitanteId: 'h3', para: 'energia' },
    ]);
  });

  it('o limite é por aluno: dois alunos andam no mesmo instante', async () => {
    const ctx = vilaComAmeacas();
    await ctx.service.mover('a3', 'p1', 'energia');
    await ctx.service.mover('a4', 'p1', 'comercio');
    expect(ctx.partida.deslocamentosNoite).toHaveLength(2);
  });

  it('depois de andar, a troca vale para vizinho da ORIGEM, nunca do destino', async () => {
    const ctx = vilaComAmeacas();
    await ctx.service.mover('a3', 'p1', 'energia');
    avancar(1_000);
    // Comunicação é vizinha da Energia (destino), não da Segurança (origem).
    const e = await ctx.service
      .mover('a3', 'p1', 'comunicacao')
      .catch((x) => x);
    expect(e).toBeInstanceOf(BadRequestException);
    expect(codigo(e)).toBe('SEM_ESTRADA');
    avancar(1_000);
    await ctx.service.mover('a3', 'p1', 'comercio');
    expect(ctx.partida.deslocamentosNoite).toEqual([
      { habitanteId: 'h3', para: 'comercio' },
    ]);
  });

  it('quem saiu da vila não gera aviso', async () => {
    const ctx = vilaComAmeacas();
    ctx.partida.habitantes.find((h) => h.id === 'h3')!.vivo = false;
    await expect(
      ctx.service.mover('a3', 'p1', 'energia'),
    ).rejects.toBeDefined();
    expect(ctx.partida.deslocamentosNoite).toEqual([]);
  });
});

/** Um gerador "aleatório" que devolve a sequência dada (e repete o último). */
const sequencia = (...valores: number[]) => {
  let i = 0;
  return () => valores[Math.min(i++, valores.length - 1)];
};
const [MIN, MAX] = ISOLATEUS.NPC_AVISO_JANELA_MS;

describe('Isolateus 026 — a agenda dos NPCs (Task 3)', () => {
  const inicio = Date.parse('2026-10-07T12:00:00.000Z');

  it('só NPCs vivos e livres entram na agenda; reais nunca', () => {
    const { partida } = vilaComAmeacas({ npcs: 3 });
    partida.habitantes.find((h) => h.id === 'n2')!.vivo = false;
    partida.habitantes.find((h) => h.id === 'n3')!.preso = true;
    const agenda = sortearAgendaNpc(
      partida.habitantes,
      ['n1', 'n2', 'n3'],
      inicio,
      () => 0, // todo NPC anda e muda de ideia
    );
    expect(new Set(agenda.map((a) => a.habitanteId))).toEqual(new Set(['n1']));
  });

  it('com o sorteio acima da chance, nenhum NPC anda', () => {
    const { partida } = vilaComAmeacas({ npcs: 3 });
    const agenda = sortearAgendaNpc(
      partida.habitantes,
      ['n1', 'n2', 'n3'],
      inicio,
      () => 0.99,
    );
    expect(agenda).toEqual([]);
  });

  it('anda um vizinho, avisa dentro da faixa e, se mudar de ideia, avisa de novo DEPOIS', () => {
    const { partida } = vilaComAmeacas({ npcs: 1 });
    // anda (0) → vizinho 0 → horário 0 → muda de ideia (0) → opção 0 → horário 0
    const agenda = sortearAgendaNpc(
      partida.habitantes,
      ['n1'],
      inicio,
      () => 0,
    );
    expect(agenda).toHaveLength(2);
    const [primeiro, segundo] = agenda;
    expect(primeiro.para).toBe(vizinhosDe('seguranca')[0]);
    expect(Date.parse(primeiro.em)).toBe(inicio + MIN);
    expect(Date.parse(segundo.em)).toBeGreaterThan(Date.parse(primeiro.em));
    expect(segundo.para).not.toBe(primeiro.para);
  });

  it('propriedades com sorteio real: faixa, ordem, estradas e troca de fato', () => {
    const { partida } = vilaComAmeacas({
      npcs: 6,
      posicoes: {
        n1: 'seguranca',
        n2: 'energia',
        n3: 'abastecimento',
        n4: 'comunicacao',
        n5: 'comercio',
        n6: 'saude',
      },
    });
    const ids = ['n1', 'n2', 'n3', 'n4', 'n5', 'n6'];
    for (let rodada = 0; rodada < 200; rodada++) {
      const agenda = sortearAgendaNpc(partida.habitantes, ids, inicio);
      for (const id of ids) {
        const dele = agenda.filter((a) => a.habitanteId === id);
        expect(dele.length).toBeLessThanOrEqual(2);
        const origem = partida.habitantes.find((h) => h.id === id)!.setorId;
        for (const a of dele) {
          const t = Date.parse(a.em) - inicio;
          expect(t).toBeGreaterThanOrEqual(MIN);
          expect(t).toBeLessThanOrEqual(MAX);
          if (a.para) expect(vizinhosDe(origem)).toContain(a.para);
        }
        if (dele.length === 2) {
          expect(Date.parse(dele[1].em)).toBeGreaterThan(
            Date.parse(dele[0].em),
          );
          expect(dele[1].para).not.toBe(dele[0].para);
          expect(dele[0].para).not.toBeNull();
        }
      }
      // Em ordem de horário, para a liberação ler do começo.
      const tempos = agenda.map((a) => Date.parse(a.em));
      expect(tempos).toEqual([...tempos].sort((a, b) => a - b));
    }
  });

  it('a virada da noite sorteia a agenda e zera os avisos públicos', async () => {
    const ctx = vilaComAmeacas({ npcs: 3, status: 'RESULTADO_RODADA' });
    ctx.partida.deslocamentosNoite = [{ habitanteId: 'h3', para: 'energia' }];
    const random = jest.spyOn(Math, 'random').mockReturnValue(0);
    avancar(ISOLATEUS.JANELA_DECISAO_MS + 1);
    await ctx.service.resolverPorTempo('p1', { professorId: 'prof' });
    random.mockRestore();

    expect(ctx.partida.status).toBe('DESLOCAMENTO');
    expect(ctx.partida.deslocamentosNoite).toEqual([]);
    expect(ctx.segredo.agendaNpc?.length).toBeGreaterThan(0);
    const base = Date.parse(ctx.partida.faseIniciadaEm!);
    for (const a of ctx.segredo.agendaNpc!) {
      expect(a.habitanteId).toMatch(/^n/);
      expect(Date.parse(a.em) - base).toBeGreaterThanOrEqual(MIN);
    }
  });

  it('no fechamento, cada NPC termina no ÚLTIMO aviso dele; sem aviso, fica', async () => {
    const ctx = vilaComAmeacas({ npcs: 3 });
    const em = (ms: number) => new Date(agora + ms).toISOString();
    ctx.segredo.agendaNpc = [
      { habitanteId: 'n1', para: 'energia', em: em(2_000) },
      { habitanteId: 'n2', para: 'comercio', em: em(3_000) },
      { habitanteId: 'n2', para: null, em: em(9_000) }, // desistiu
    ];
    avancar(ISOLATEUS.LIMITE_DESLOCAMENTO_MS + 1);
    await ctx.service.resolverPorTempo('p1', { professorId: 'prof' });

    expect(ctx.setorDe('n1')).toBe('energia');
    expect(ctx.setorDe('n2')).toBe('seguranca');
    expect(ctx.setorDe('n3')).toBe('seguranca'); // sem aviso: não sorteia mais
    expect(ctx.segredo.agendaNpc).toEqual([]);
  });
});

describe('Isolateus 026 — liberação da agenda e pulso (Task 4)', () => {
  /** Vila com NPCs e uma agenda relativa ao "agora" do teste. */
  const comAgenda = (
    avisos: Array<[string, string | null, number]>,
    opts: Parameters<typeof vilaComAmeacas>[0] = {},
  ) => {
    const ctx = vilaComAmeacas({ npcs: 3, ...opts });
    ctx.segredo.agendaNpc = avisos.map(([habitanteId, para, ms]) => ({
      habitanteId,
      para,
      em: new Date(agora + ms).toISOString(),
    }));
    return ctx;
  };
  const commits = (ctx: ReturnType<typeof vilaComAmeacas>) =>
    (ctx.repo.commitPartida as jest.Mock).mock.calls.length;

  it('o pulso do /tempo libera só os avisos vencidos, sem fechar a noite', async () => {
    const ctx = comAgenda([
      ['n1', 'energia', 2_000],
      ['n2', 'comercio', 10_000],
    ]);
    avancar(3_000);
    await ctx.service.resolverPorTempo('p1', { professorId: 'prof' });

    expect(ctx.partida.status).toBe('DESLOCAMENTO');
    expect(ctx.partida.deslocamentosNoite).toEqual([
      { habitanteId: 'n1', para: 'energia' },
    ]);
    expect(ctx.segredo.agendaNpc!.map((a) => a.habitanteId)).toEqual(['n2']);
    // O NPC liberado conta como "está indo": a fileira da Ameaça já o vê no
    // destino, como um real que andou.
    expect(ctx.segredo.posicoesNoite).toEqual([
      { habitanteId: 'n1', setorId: 'energia' },
    ]);
  });

  it('é idempotente: um segundo pulso não duplica nem escreve', async () => {
    const ctx = comAgenda([['n1', 'energia', 2_000]]);
    avancar(3_000);
    await ctx.service.resolverPorTempo('p1', { professorId: 'prof' });
    const antes = commits(ctx);
    await ctx.service.resolverPorTempo('p1', { alunoId: 'a3' });
    expect(commits(ctx)).toBe(antes);
    expect(ctx.partida.deslocamentosNoite).toHaveLength(1);
  });

  it('sem aviso vencido, o pulso não escreve nada', async () => {
    const ctx = comAgenda([['n1', 'energia', 10_000]]);
    avancar(3_000);
    await ctx.service.resolverPorTempo('p1', { alunoId: 'a3' });
    expect(commits(ctx)).toBe(0);
  });

  it('a desistência do NPC retira o aviso dele', async () => {
    const ctx = comAgenda([
      ['n1', 'energia', 2_000],
      ['n1', null, 4_000],
    ]);
    avancar(3_000);
    await ctx.service.resolverPorTempo('p1', { professorId: 'prof' });
    expect(ctx.partida.deslocamentosNoite).toHaveLength(1);
    avancar(2_000);
    await ctx.service.resolverPorTempo('p1', { professorId: 'prof' });
    expect(ctx.partida.deslocamentosNoite).toEqual([]);
    expect(ctx.segredo.posicoesNoite).toEqual([]);
  });

  it('qualquer requisição da noite também libera: mover, confirmar, jogada', async () => {
    const ctx = comAgenda([
      ['n1', 'energia', 1_000],
      ['n2', 'comercio', 2_000],
      ['n3', 'energia', 3_000],
    ]);
    avancar(1_500);
    await ctx.service.mover('a3', 'p1', 'comercio');
    expect(ctx.partida.deslocamentosNoite.map((d) => d.habitanteId)).toEqual([
      'n1',
      'h3',
    ]);
    avancar(1_000);
    await ctx.service.confirmarPosicao('a4', 'p1');
    expect(ctx.partida.deslocamentosNoite.map((d) => d.habitanteId)).toContain(
      'n2',
    );
    avancar(1_000);
    await ctx.service.acaoAmeaca('a1', 'p1', { tipo: 'AGUARDAR' });
    expect(ctx.partida.deslocamentosNoite.map((d) => d.habitanteId)).toContain(
      'n3',
    );
  });

  it('na carência, os avisos restantes passam a cair dentro dela', async () => {
    const ctx = comAgenda([['n1', 'energia', 30_000]], { ameacas: ['a1'] });
    avancar(5_000);
    // Todos os reais confirmam; falta só a jogada da Ameaça → carência.
    for (const a of ['a1', 'a2', 'a3', 'a4', 'a5']) {
      await ctx.service.confirmarPosicao(a, 'p1');
    }
    expect(ctx.partida.status).toBe('DESLOCAMENTO');
    const em = Date.parse(ctx.segredo.agendaNpc![0].em);
    expect(em).toBeGreaterThan(agora);
    expect(em).toBeLessThanOrEqual(agora + ISOLATEUS.CARENCIA_AMEACA_MS);
  });

  it('reescalarAgenda comprime proporcionalmente e mantém a ordem', () => {
    const base = 1_000_000;
    const agenda = [10_000, 20_000, 40_000].map((ms, i) => ({
      habitanteId: `n${i}`,
      para: 'energia',
      em: new Date(base + ms).toISOString(),
    }));
    const nova = reescalarAgenda(agenda, base, base + 60_000, base + 6_000);
    expect(nova.map((a) => Date.parse(a.em) - base)).toEqual([
      1_000, 2_000, 4_000,
    ]);
  });
});

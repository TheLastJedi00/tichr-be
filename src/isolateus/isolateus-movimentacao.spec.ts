import { ISOLATEUS } from './entities/isolateus-match.entity';
import { sortearAgendaNpc } from './isolateus-deslocamento';
import { vilaComAmeacas } from './isolateus-vila.fixture-spec';
import { vizinhosDe } from './isolateus.data';

/**
 * 026 — Movimentação em tempo real. Os avisos de saída da noite
 * (`deslocamentosNoite`), a agenda dos NPCs e as saídas e chegadas do amanhecer
 * (`ultimosDeslocamentos`).
 */

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

const LIMITE = ISOLATEUS.LIMITE_DESLOCAMENTO_MS;
const MIN = Math.round(LIMITE * ISOLATEUS.NPC_JANELA_FRACAO[0]);
const MAX = Math.round(LIMITE * ISOLATEUS.NPC_JANELA_FRACAO[1]);

describe('Isolateus — a duração da noite (036)', () => {
  it('a noite legada (partidas antigas) é de 15 segundos', () => {
    expect(ISOLATEUS.LIMITE_DESLOCAMENTO_MS).toBe(15_000);
  });

  it('a agenda dos NPCs cabe dentro de qualquer duração escolhida', () => {
    const { partida } = vilaComAmeacas({ npcs: 6 });
    for (const s of ISOLATEUS.OPCOES_NOITE_S) {
      const agenda = sortearAgendaNpc(
        partida.habitantes,
        ['n1', 'n2', 'n3', 'n4', 'n5', 'n6'],
        0,
        s * 1000,
        () => 0.01,
      );
      for (const a of agenda) {
        expect(Date.parse(a.em)).toBeGreaterThanOrEqual(s * 100);
        expect(Date.parse(a.em)).toBeLessThan(s * 1000);
      }
    }
  });
});

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
      LIMITE,
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
      LIMITE,
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
      LIMITE,
      () => 0,
    );
    expect(agenda).toHaveLength(2);
    const [primeiro, segundo] = agenda;
    expect(primeiro.para).toBe(vizinhosDe('seguranca')[0]);
    expect(Date.parse(primeiro.em)).toBe(inicio + MIN);
    expect(Date.parse(segundo.em)).toBeGreaterThan(Date.parse(primeiro.em));
    expect(segundo.para).not.toBe(primeiro.para);
  });

  it('propriedades com sorteio real: faixa, ordem e travessias por estrada (036)', () => {
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
      const agenda = sortearAgendaNpc(partida.habitantes, ids, inicio, LIMITE);
      for (const id of ids) {
        const dele = agenda.filter((a) => a.habitanteId === id);
        expect(dele.length).toBeLessThanOrEqual(2);
        const origem = partida.habitantes.find((h) => h.id === id)!.setorId;
        for (const a of dele) {
          const t = Date.parse(a.em) - inicio;
          expect(t).toBeGreaterThanOrEqual(MIN);
          expect(t).toBeLessThanOrEqual(MAX);
          expect(a.para).not.toBeNull();
        }
        if (dele[0]) expect(vizinhosDe(origem)).toContain(dele[0].para);
        if (dele.length === 2) {
          // A segunda travessia parte do setor novo, depois de dar tempo de
          // andar até a porta.
          expect(vizinhosDe(dele[0].para!)).toContain(dele[1].para);
          expect(
            Date.parse(dele[1].em) - Date.parse(dele[0].em),
          ).toBeGreaterThanOrEqual(ISOLATEUS.NPC_INTERVALO_TRAVESSIAS_MS);
        }
      }
      // Em ordem de horário, para a liberação ler do começo.
      const tempos = agenda.map((a) => Date.parse(a.em));
      expect(tempos).toEqual([...tempos].sort((a, b) => a - b));
    }
  });

  it('a virada da noite sorteia a agenda na duração da partida', async () => {
    const ctx = vilaComAmeacas({ npcs: 3, status: 'RESULTADO_RODADA' });
    ctx.partida.limiteNoiteMs = 30_000;
    const random = jest.spyOn(Math, 'random').mockReturnValue(0);
    avancar(ISOLATEUS.JANELA_DECISAO_MS + 1);
    await ctx.service.resolverPorTempo('p1', { professorId: 'prof' });
    random.mockRestore();

    expect(ctx.partida.status).toBe('DESLOCAMENTO');
    expect(ctx.segredo.agendaNpc?.length).toBeGreaterThan(0);
    const base = Date.parse(ctx.partida.faseIniciadaEm!);
    for (const a of ctx.segredo.agendaNpc!) {
      expect(a.habitanteId).toMatch(/^n/);
      expect(Date.parse(a.em) - base).toBeGreaterThanOrEqual(3_000);
    }
  });

  it('travessia que não saiu até o fechamento é descartada', async () => {
    const ctx = vilaComAmeacas({ npcs: 2 });
    ctx.segredo.agendaNpc = [
      {
        habitanteId: 'n1',
        para: 'energia',
        em: new Date(agora + 60_000).toISOString(),
      },
    ];
    avancar(ISOLATEUS.LIMITE_DESLOCAMENTO_MS + 1);
    await ctx.service.resolverPorTempo('p1', { professorId: 'prof' });
    expect(ctx.partida.status).toBe('QUESTAO_ATIVA');
    expect(ctx.setorDe('n1')).toBe('seguranca');
    expect(ctx.segredo.agendaNpc).toEqual([]);
  });
});

describe('Isolateus 036 — NPCs atravessam ao vivo (Task 5)', () => {
  /** Vila com NPCs e uma agenda relativa ao "agora" do teste. */
  const comAgenda = (
    travessias: Array<[string, string, number]>,
    opts: Parameters<typeof vilaComAmeacas>[0] = {},
  ) => {
    const ctx = vilaComAmeacas({ npcs: 3, ...opts });
    ctx.segredo.agendaNpc = travessias.map(([habitanteId, para, ms]) => ({
      habitanteId,
      para,
      em: new Date(agora + ms).toISOString(),
    }));
    return ctx;
  };
  const commits = (ctx: ReturnType<typeof vilaComAmeacas>) =>
    (ctx.repo.transacao as jest.Mock).mock.calls.length;

  it('o pulso do /tempo atravessa só as vencidas, na hora e em público', async () => {
    const ctx = comAgenda([
      ['n1', 'energia', 2_000],
      ['n2', 'comercio', 10_000],
    ]);
    avancar(3_000);
    await ctx.service.resolverPorTempo('p1', { professorId: 'prof' });
    expect(ctx.partida.status).toBe('DESLOCAMENTO');
    expect(ctx.setorDe('n1')).toBe('energia');
    expect(ctx.setorDe('n2')).toBe('seguranca');
    expect(ctx.segredo.agendaNpc!.map((a) => a.habitanteId)).toEqual(['n2']);
  });

  it('duas travessias em sequência: de vizinho em vizinho', async () => {
    const ctx = comAgenda([
      ['n1', 'energia', 1_000],
      ['n1', 'comunicacao', 4_000],
    ]);
    avancar(5_000);
    await ctx.service.resolverPorTempo('p1', { professorId: 'prof' });
    expect(ctx.setorDe('n1')).toBe('comunicacao');
  });

  it('travessia sem estrada a partir do setor atual é descartada', async () => {
    const ctx = comAgenda([['n1', 'abastecimento', 1_000]]);
    avancar(2_000);
    await ctx.service.resolverPorTempo('p1', { professorId: 'prof' });
    expect(ctx.setorDe('n1')).toBe('seguranca');
    expect(ctx.segredo.agendaNpc).toEqual([]);
  });

  it('é idempotente: um segundo pulso não atravessa de novo nem escreve', async () => {
    const ctx = comAgenda([['n1', 'energia', 2_000]]);
    avancar(3_000);
    await ctx.service.resolverPorTempo('p1', { professorId: 'prof' });
    const antes = commits(ctx);
    await ctx.service.resolverPorTempo('p1', { alunoId: 'a3' });
    expect(commits(ctx)).toBe(antes);
    expect(ctx.setorDe('n1')).toBe('energia');
  });

  it('sem travessia vencida, o pulso não escreve nada', async () => {
    const ctx = comAgenda([['n1', 'energia', 10_000]]);
    avancar(3_000);
    await ctx.service.resolverPorTempo('p1', { alunoId: 'a3' });
    expect(commits(ctx)).toBe(0);
  });

  it('pausada, ninguém atravessa', async () => {
    const ctx = comAgenda([['n1', 'energia', 1_000]]);
    ctx.partida.pausadaEm = new Date(agora).toISOString();
    avancar(2_000);
    await ctx.service.resolverPorTempo('p1', { alunoId: 'a3' }).catch(() => {});
    expect(ctx.setorDe('n1')).toBe('seguranca');
  });

  it('qualquer requisição da noite também libera: mover, confirmar, jogada', async () => {
    const ctx = comAgenda([
      ['n1', 'energia', 1_000],
      ['n2', 'comercio', 2_000],
      ['n3', 'energia', 3_000],
    ]);
    avancar(1_500);
    await ctx.service.mover('a3', 'p1', 'comercio');
    expect(ctx.setorDe('n1')).toBe('energia');
    avancar(1_000);
    await ctx.service.confirmarPosicao('a4', 'p1');
    expect(ctx.setorDe('n2')).toBe('comercio');
    avancar(1_000);
    await ctx.service.acaoAmeaca('a1', 'p1', { tipo: 'AGUARDAR' });
    expect(ctx.setorDe('n3')).toBe('energia');
  });
});

describe('Isolateus 026 — o Delírio na noite (036)', () => {
  it('o Delírio do professor remapeia a agenda; a travessia sai com o id novo', async () => {
    const ctx = vilaComAmeacas({ npcs: 1 });
    ctx.segredo.agendaNpc = [
      {
        habitanteId: 'n1',
        para: 'energia',
        em: new Date(agora + 8_000).toISOString(),
      },
    ];
    await ctx.service.delirioDoProfessor('prof', 'p1');
    const npcNovo = ctx.segredo.npcIds[0];
    expect(npcNovo).not.toBe('n1');
    expect(ctx.segredo.agendaNpc[0].habitanteId).toBe(npcNovo);
    avancar(9_000);
    await ctx.service.resolverPorTempo('p1', { alunoId: 'a4' });
    expect(ctx.setorDe(npcNovo)).toBe('energia');
  });

  it('o Delírio do professor apaga o último amanhecer de partidas antigas', async () => {
    const ctx = vilaComAmeacas({ status: 'RESULTADO_RODADA' });
    ctx.partida.ultimosDeslocamentos = {
      rodada: 0,
      movimentos: [{ habitanteId: 'h3', de: 'seguranca', para: 'energia' }],
    };
    await ctx.service.delirioDoProfessor('prof', 'p1');
    expect(ctx.partida.ultimosDeslocamentos).toBeNull();
  });
});

describe('Isolateus 026 — corrida entre o pulso e o mover (transação)', () => {
  /**
   * Repositório que se comporta como o Firestore: cada leitura devolve uma
   * CÓPIA, e só o que é gravado muda o "banco". `aoLerCofre` roda logo depois
   * de uma leitura, simulando outra requisição que gravou no meio.
   */
  function bancoComCorrida() {
    const ctx = vilaComAmeacas({ npcs: 2 });
    const copia = <T>(o: T): T =>
      Object.assign(
        Object.create(Object.getPrototypeOf(o) as object),
        structuredClone({ ...o }),
      ) as T;
    const banco = { partida: copia(ctx.partida), segredo: copia(ctx.segredo) };
    let aoLerCofre: (() => void) | null = null;
    const repo = ctx.repo as unknown as Record<string, jest.Mock>;
    type Escrita = { publico?: object; segredo?: object } | null;
    repo.buscar.mockImplementation(() => Promise.resolve(copia(banco.partida)));
    repo.buscarSegredo.mockImplementation(() => {
      const lido = copia(banco.segredo);
      const gancho = aoLerCofre;
      aoLerCofre = null;
      gancho?.();
      return Promise.resolve(lido);
    });
    repo.commitPartida.mockImplementation(
      (_id: string, pub: object = {}, seg: object = {}) => {
        Object.assign(banco.partida, pub);
        Object.assign(banco.segredo, seg);
        return Promise.resolve();
      },
    );
    repo.transacao.mockImplementation(
      (_id: string, fn: (p: unknown, s: unknown) => Escrita) => {
        const p = copia(banco.partida);
        const s = copia(banco.segredo);
        const r = fn(p, s);
        if (!r) return Promise.resolve(null);
        Object.assign(banco.partida, r.publico ?? {});
        Object.assign(banco.segredo, r.segredo ?? {});
        return Promise.resolve({ partida: p, segredo: s });
      },
    );
    return { ...ctx, banco, depoisDeLer: (f: () => void) => (aoLerCofre = f) };
  }

  it('um aluno que atravessa enquanto o pulso move um NPC não perde a travessia', async () => {
    const ctx = bancoComCorrida();
    ctx.banco.segredo.agendaNpc = [
      {
        habitanteId: 'n1',
        para: 'energia',
        em: new Date(agora + 1_000).toISOString(),
      },
    ];
    avancar(2_000);
    // O pulso lê o cofre; logo em seguida, o aluno a3 atravessa (outra
    // requisição).
    ctx.depoisDeLer(() => {
      ctx.banco.partida.habitantes = ctx.banco.partida.habitantes.map((h) =>
        h.id === 'h3' ? { ...h, setorId: 'comercio' } : h,
      );
    });
    await ctx.service.resolverPorTempo('p1', { professorId: 'prof' });
    const setor = (id: string) =>
      ctx.banco.partida.habitantes.find((h) => h.id === id)!.setorId;
    expect(setor('h3')).toBe('comercio');
    expect(setor('n1')).toBe('energia');
  });

  it('dois alunos atravessando ao mesmo tempo: o segundo não apaga o primeiro (036)', async () => {
    const ctx = bancoComCorrida();
    ctx.depoisDeLer(() => {
      ctx.banco.partida.habitantes = ctx.banco.partida.habitantes.map((h) =>
        h.id === 'h4' ? { ...h, setorId: 'energia' } : h,
      );
    });
    await ctx.service.mover('a3', 'p1', 'comercio');
    const setor = (id: string) =>
      ctx.banco.partida.habitantes.find((h) => h.id === id)!.setorId;
    expect(setor('h4')).toBe('energia');
    expect(setor('h3')).toBe('comercio');
  });
});

describe('Isolateus 026 — a noite fecha uma vez só', () => {
  it('um segundo fechamento com leitura velha não reverte a noite', async () => {
    const ctx = vilaComAmeacas({ npcs: 1 });
    ctx.segredo.agendaNpc = [];
    await ctx.service.mover('a3', 'p1', 'energia');
    avancar(ISOLATEUS.LIMITE_DESLOCAMENTO_MS + 1);

    // Uma requisição leu a partida ANTES do amanhecer (status DESLOCAMENTO,
    // posições antigas) e chega depois que a noite já fechou.
    const velha = structuredClone({ ...ctx.partida });
    await ctx.service.resolverPorTempo('p1', { professorId: 'prof' });
    expect(ctx.setorDe('h3')).toBe('energia');
    const amanhecer = ctx.partida.ultimosDeslocamentos;

    const repo = ctx.repo as unknown as { buscar: jest.Mock };
    repo.buscar.mockImplementationOnce(() =>
      Promise.resolve(
        Object.assign(
          Object.create(Object.getPrototypeOf(ctx.partida) as object),
          velha,
        ),
      ),
    );
    await ctx.service.resolverPorTempo('p1', { alunoId: 'a4' });

    expect(ctx.setorDe('h3')).toBe('energia');
    expect(ctx.partida.ultimosDeslocamentos).toEqual(amanhecer);
  });
});

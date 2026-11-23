import { HttpException } from '@nestjs/common';
import { CENA, xDaPorta } from './isolateus-cena';
import { IsolateusPosicaoService } from './isolateus-posicao.service';
import { vilaComAmeacas } from './isolateus-vila.fixture-spec';
import { IsolateusGameService } from './isolateus-game.service';

/** 034 Fase 1 — o canal de posição (RTDB escrito só pelo backend). */

const codigo = (e: unknown) =>
  ((e as HttpException).getResponse() as { code?: string }).code;

/** RTDB em memória, com a mesma interface do cliente REST. */
function rtdbFalso() {
  const dados = new Map<string, unknown>();
  return {
    dados,
    habilitado: true,
    ler: jest.fn(async (caminho: string) => dados.get(caminho) ?? null),
    gravar: jest.fn(async (caminho: string, valor: unknown) => {
      dados.set(caminho, valor);
    }),
    apagar: jest.fn(async (prefixo: string) => {
      for (const k of [...dados.keys()]) {
        if (k === prefixo || k.startsWith(prefixo + '/')) dados.delete(k);
      }
    }),
  };
}
function authFalso() {
  return {
    createCustomToken: jest.fn(
      async (uid: string, claims: Record<string, unknown>) =>
        `token:${uid}:${JSON.stringify(claims)}`,
    ),
  };
}

let agora = Date.parse('2026-11-12T12:00:00.000Z');
beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  agora = Date.parse('2026-11-12T12:00:00.000Z');
  jest.setSystemTime(agora);
});
afterEach(() => jest.useRealTimers());
const avancar = (ms: number) => {
  agora += ms;
  jest.setSystemTime(agora);
};

function montar(opts: Parameters<typeof vilaComAmeacas>[0] = {}) {
  const ctx = vilaComAmeacas(opts);
  const rtdb = rtdbFalso();
  const auth = authFalso();
  const posicao = new IsolateusPosicaoService(rtdb as never, { auth } as never);
  const service = new IsolateusGameService(
    ctx.repo,
    { findById: async () => ({ id: 'j1', questoes: [] }) } as never,
    { creditarPartida: jest.fn(), penalizarJogo: jest.fn() } as never,
    undefined,
    undefined,
    posicao,
  );
  return { ...ctx, service, rtdb, auth, posicao };
}

describe('Isolateus 034 — POST passo (Task 2)', () => {
  it('grava { x, alvoX, t } em pos/{partida}/{setor}/{habitante}', async () => {
    const c = montar();
    await c.service.passo('a3', 'p1', 250);
    expect(c.rtdb.dados.get('pos/p1/seguranca/h3')).toEqual({
      x: CENA.LARGURA / 2,
      alvoX: 250,
      t: agora,
    });
  });

  it('o x de saída vem do último passo e da velocidade fixa', async () => {
    const c = montar();
    await c.service.passo('a3', 'p1', 250);
    avancar(1000);
    await c.service.passo('a3', 'p1', 0);
    const g = c.rtdb.dados.get('pos/p1/seguranca/h3') as { x: number };
    expect(g.x).toBeCloseTo(CENA.LARGURA / 2 + CENA.VELOCIDADE);
  });

  it('429 PASSO_RAPIDO abaixo de 250 ms (036 #25: apertar e soltar a tecla)', async () => {
    const c = montar();
    await c.service.passo('a3', 'p1', 250);
    avancar(100);
    const erro = await c.service.passo('a3', 'p1', 10).catch((e) => e);
    expect(erro).toBeInstanceOf(HttpException);
    expect((erro as HttpException).getStatus()).toBe(429);
    expect(codigo(erro)).toBe('PASSO_RAPIDO');
    avancar(200);
    await expect(c.service.passo('a3', 'p1', 10)).resolves.toBeDefined();
  });

  it('alvo fora da cena: 400 ALVO_FORA_DA_CENA e nada gravado', async () => {
    const c = montar();
    const erro = await c.service
      .passo('a3', 'p1', CENA.LARGURA + 50)
      .catch((e) => e);
    expect(codigo(erro)).toBe('ALVO_FORA_DA_CENA');
    expect(c.rtdb.gravar).not.toHaveBeenCalled();
  });

  it('abduzido ou preso: recusado e nada gravado', async () => {
    const c = montar();
    c.partida.habitantes.find((h) => h.id === 'h3')!.vivo = false;
    c.partida.habitantes.find((h) => h.id === 'h4')!.preso = true;
    await expect(c.service.passo('a3', 'p1', 10)).rejects.toBeInstanceOf(
      HttpException,
    );
    await expect(c.service.passo('a4', 'p1', 10)).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(c.rtdb.gravar).not.toHaveBeenCalled();
  });

  it('partida encerrada: recusado', async () => {
    const c = montar({ status: 'ENCERRADO' });
    await expect(c.service.passo('a3', 'p1', 10)).rejects.toBeInstanceOf(
      HttpException,
    );
  });

  it('grava no setor ATUAL: depois da travessia, já é o novo (036)', async () => {
    const c = montar();
    c.partida.habitantes.find((h) => h.id === 'h3')!.setorId = 'energia';
    await c.service.passo('a3', 'p1', 40);
    expect(c.rtdb.dados.has('pos/p1/energia/h3')).toBe(true);
    expect(c.rtdb.dados.has('pos/p1/seguranca/h3')).toBe(false);
  });

  it('partida pausada: 409, como todo comando', async () => {
    const c = montar();
    c.partida.pausadaEm = new Date(agora).toISOString();
    const erro = await c.service.passo('a3', 'p1', 10).catch((e) => e);
    expect((erro as HttpException).getStatus()).toBe(409);
  });
});

describe('Isolateus 036 — a porta (Task 4)', () => {
  /** Anda até `x` e espera chegar. */
  async function andarAte(
    c: ReturnType<typeof montar>,
    aluno: string,
    x: number,
  ) {
    await c.service.passo(aluno, 'p1', x);
    avancar(10_000);
  }

  it('longe da porta: 400 LONGE_DA_PORTA e ninguém atravessa', async () => {
    const c = montar();
    // Nasce no meio da cena (X_INICIAL), longe das portas.
    const e = await c.service.mover('a3', 'p1', 'energia').catch((x) => x);
    expect(codigo(e)).toBe('LONGE_DA_PORTA');
    expect(c.setorDe('h3')).toBe('seguranca');
  });

  it('na zona da porta, atravessa (com tolerância)', async () => {
    const c = montar();
    const porta = xDaPorta('seguranca', 'energia')!;
    const dentro = porta > CENA.LARGURA / 2 ? -1 : 1;
    await andarAte(c, 'a3', porta + dentro * (CENA.ZONA_PORTA - 1));
    await c.service.mover('a3', 'p1', 'energia');
    expect(c.setorDe('h3')).toBe('energia');
  });

  it('a porta certa: estar na porta de outro vizinho não vale', async () => {
    const c = montar();
    await andarAte(c, 'a3', xDaPorta('seguranca', 'comercio')!);
    const e = await c.service.mover('a3', 'p1', 'energia').catch((x) => x);
    expect(codigo(e)).toBe('LONGE_DA_PORTA');
  });

  it('a travessia tira o boneco do setor antigo e o põe na porta de chegada', async () => {
    const c = montar();
    await andarAte(c, 'a3', xDaPorta('seguranca', 'energia')!);
    await c.service.mover('a3', 'p1', 'energia');
    expect(c.rtdb.dados.has('pos/p1/seguranca/h3')).toBe(false);
    const chegada = xDaPorta('energia', 'seguranca')!;
    const novo = c.rtdb.dados.get('pos/p1/energia/h3') as {
      x: number;
      alvoX: number;
    };
    expect(novo.x).toBe(chegada);
    // Entra um pouco para dentro da cena, fora da zona da porta.
    expect(Math.abs(novo.alvoX - chegada)).toBeGreaterThan(CENA.ZONA_PORTA);
  });

  it('a resposta traz o token do canal do setor novo', async () => {
    const c = montar();
    await andarAte(c, 'a3', xDaPorta('seguranca', 'energia')!);
    const r = await c.service.mover('a3', 'p1', 'energia');
    expect(r.tokenCanal).toContain('"setorId":"energia"');
  });

  it('"ficar" não exige porta', async () => {
    const c = montar();
    await c.service.mover('a3', 'p1', 'seguranca');
    expect(c.segredo.confirmacoesNoite).toContain('a3');
  });
});

describe('Isolateus 034 — GET canal (Task 1)', () => {
  it('emite o custom token com { partidaId, setorId } do setor atual', async () => {
    const c = montar({ posicoes: { h3: 'energia' } });
    const r = await c.service.canal('a3', 'p1');
    expect(c.auth.createCustomToken).toHaveBeenCalledWith(
      expect.stringContaining('a3') as unknown,
      { partidaId: 'p1', setorId: 'energia' },
    );
    expect(r).toEqual({
      token: expect.any(String) as unknown,
      partidaId: 'p1',
      setorId: 'energia',
    });
  });

  it('abduzido ou preso: sem canal', async () => {
    const c = montar();
    c.partida.habitantes.find((h) => h.id === 'h3')!.vivo = false;
    await expect(c.service.canal('a3', 'p1')).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(c.auth.createCustomToken).not.toHaveBeenCalled();
  });

  it('quem não é da partida não recebe canal', async () => {
    const c = montar();
    await expect(c.service.canal('intruso', 'p1')).rejects.toBeInstanceOf(
      HttpException,
    );
  });
});

describe('Isolateus 034 — limpeza (Task 3)', () => {
  it('limpar remove pos/{partida} inteiro', async () => {
    const c = montar();
    await c.service.passo('a3', 'p1', 250);
    await c.posicao.limpar('p1');
    expect([...c.rtdb.dados.keys()].some((k) => k.startsWith('pos/p1'))).toBe(
      false,
    );
  });
});

describe('Isolateus 034 — NPCs no mesmo canal (Task 3)', () => {
  const chaves = (o: unknown) => Object.keys(o as object).sort();

  it('no pulso do /tempo, o NPC grava o MESMO formato de um aluno', async () => {
    const c = montar({ npcs: 2 });
    jest.spyOn(Math, 'random').mockReturnValue(0.1);
    await c.service.passo('a3', 'p1', 250);
    await c.service.resolverPorTempo('p1', { alunoId: 'a3' });
    const real = c.rtdb.dados.get('pos/p1/seguranca/h3');
    const npc = c.rtdb.dados.get('pos/p1/seguranca/n1');
    expect(npc).toBeDefined();
    expect(chaves(npc)).toEqual(chaves(real));
    expect(chaves(npc)).toEqual(['alvoX', 't', 'x']);
    jest.restoreAllMocks();
  });

  it('o pulso não repassa os NPCs antes da janela', async () => {
    const c = montar({ npcs: 1 });
    jest.spyOn(Math, 'random').mockReturnValue(0.1);
    await c.service.resolverPorTempo('p1', { alunoId: 'a3' });
    const chamadas = c.rtdb.gravar.mock.calls.length;
    await c.service.resolverPorTempo('p1', { alunoId: 'a3' });
    expect(c.rtdb.gravar.mock.calls.length).toBe(chamadas);
    jest.restoreAllMocks();
  });

  it('com a travessia perto, o NPC anda até a porta do destino (036)', async () => {
    const c = montar({ npcs: 1 });
    c.segredo.agendaNpc = [
      {
        habitanteId: 'n1',
        para: 'energia',
        em: new Date(agora + 3_000).toISOString(),
      },
    ];
    jest.spyOn(Math, 'random').mockReturnValue(0.99); // sem passeio aleatório
    await c.service.resolverPorTempo('p1', { alunoId: 'a3' });
    const npc = c.rtdb.dados.get('pos/p1/seguranca/n1') as { alvoX: number };
    expect(npc.alvoX).toBe(xDaPorta('seguranca', 'energia'));
    jest.restoreAllMocks();
  });

  it('na hora da travessia, o NPC troca de cena pela porta, como um aluno', async () => {
    const c = montar({ npcs: 1 });
    c.segredo.agendaNpc = [
      { habitanteId: 'n1', para: 'energia', em: new Date(agora).toISOString() },
    ];
    jest.spyOn(Math, 'random').mockReturnValue(0.99);
    await c.service.resolverPorTempo('p1', { alunoId: 'a3' });
    expect(c.setorDe('n1')).toBe('energia');
    expect(c.rtdb.dados.has('pos/p1/seguranca/n1')).toBe(false);
    const novo = c.rtdb.dados.get('pos/p1/energia/n1') as { x: number };
    expect(novo.x).toBe(xDaPorta('energia', 'seguranca'));
    jest.restoreAllMocks();
  });

  it('ENCERRADO apaga pos/{partida}', async () => {
    const c = montar();
    await c.service.passo('a3', 'p1', 250);
    await c.service.encerrarPeloProfessor('prof', 'p1');
    expect([...c.rtdb.dados.keys()].some((k) => k.startsWith('pos/p1'))).toBe(
      false,
    );
  });

  it('o RTDB fora do ar nunca derruba o pulso', async () => {
    const c = montar({ npcs: 1 });
    c.rtdb.ler.mockRejectedValue(new Error('RTDB fora'));
    jest.spyOn(Math, 'random').mockReturnValue(0.1);
    await expect(
      c.service.resolverPorTempo('p1', { alunoId: 'a3' }),
    ).resolves.toBeDefined();
    jest.restoreAllMocks();
  });
});

describe('Isolateus 036 — o passo devolve a caminhada (Task 11)', () => {
  it('o modo simples recebe o x de saída e o alvo, para saber quando chega', async () => {
    const c = montar();
    const r = await c.service.passo('a3', 'p1', 24);
    expect(r).toEqual({ ok: true, x: CENA.X_INICIAL, alvoX: 24, t: agora });
  });
});

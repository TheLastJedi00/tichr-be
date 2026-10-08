import { BadRequestException, HttpException } from '@nestjs/common';
import { vilaComAmeacas } from './isolateus-vila.fixture-spec';

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

import { BadRequestException } from '@nestjs/common';
import { ISOLATEUS } from './entities/isolateus-match.entity';
import { vilaComAmeacas } from './isolateus-vila.fixture-spec';

/**
 * O Contágio recarrega (028 §3): só a Ameaça original contagia, e só depois de
 * `ACERTOS_PARA_CONTAGIO` acertos dela desde o início ou o último Contágio.
 */
describe('Isolateus — Contágio a cada 2 acertos da original', () => {
  /** Uma questão em que cada aluno responde a alternativa dada (correta = 1). */
  async function questao(
    ctx: ReturnType<typeof vilaComAmeacas>,
    respostas: Record<string, number>,
  ) {
    ctx.partida.status = 'QUESTAO_ATIVA';
    for (const [alunoId, alt] of Object.entries(respostas)) {
      await ctx.service.responder(alunoId, 'p1', alt);
    }
    // A rodada seguinte: novas respostas não colidem com as desta.
    ctx.partida.rodada += 1;
  }

  /** Só a original (a1) é Ameaça; a2..a4 são aldeões. */
  const vila = () =>
    vilaComAmeacas({ status: 'QUESTAO_ATIVA', reais: 4, ameacas: ['a1'] });

  it('a constante é 2', () => {
    expect(ISOLATEUS.ACERTOS_PARA_CONTAGIO).toBe(2);
  });

  it('1º acerto: Controle e Delírio sim, Contágio não', async () => {
    const ctx = vila();
    await questao(ctx, { a1: 1, a2: 1, a3: 1, a4: 1 });

    expect(ctx.segredo.acertosDesdeContagio).toBe(1);
    const painel = await ctx.service.painel('a1', 'p1');
    expect(painel.poder).toEqual({
      CONTROLE: true,
      CONTAGIO: false,
      DELIRIO: true,
    });
    expect(painel.contagioAcertos).toEqual({ atual: 1, necessario: 2 });

    const erro = await ctx.service
      .usarPoder('a1', 'p1', { poder: 'CONTAGIO' })
      .catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(BadRequestException);
    expect((erro as BadRequestException).getResponse()).toMatchObject({
      code: 'CONTAGIO_RECARREGANDO',
    });
    expect(ctx.segredo.contagioPendente).toBeFalsy();
  });

  it('2º acerto: Contágio liberado; depois de usar, volta a 0', async () => {
    const ctx = vila();
    await questao(ctx, { a1: 1, a2: 1, a3: 1, a4: 1 });
    await questao(ctx, { a1: 1, a2: 1, a3: 1, a4: 1 });

    expect(ctx.segredo.acertosDesdeContagio).toBe(2);
    const painel = await ctx.service.painel('a1', 'p1');
    expect(painel.poder?.CONTAGIO).toBe(true);
    expect(painel.contagioAcertos).toEqual({ atual: 2, necessario: 2 });

    const depois = await ctx.service.usarPoder('a1', 'p1', {
      poder: 'CONTAGIO',
    });
    expect(ctx.segredo.contagioPendente).toBe(true);
    expect(ctx.segredo.acertosDesdeContagio).toBe(0);
    expect(depois.contagioAcertos).toEqual({ atual: 0, necessario: 2 });
  });

  it('erro não soma', async () => {
    const ctx = vila();
    await questao(ctx, { a1: 3, a2: 1, a3: 1, a4: 1 });
    expect(ctx.segredo.acertosDesdeContagio ?? 0).toBe(0);
    await questao(ctx, { a1: 1, a2: 1, a3: 1, a4: 1 });
    expect(ctx.segredo.acertosDesdeContagio).toBe(1);
  });

  it('acerto preso soma (o saldo fica para depois da fuga)', async () => {
    // Duas Ameaças: a original presa na tela hackeada, a contagiada livre.
    const ctx = vilaComAmeacas({ status: 'QUESTAO_ATIVA', reais: 4 });
    ctx.partida.habitantes.find((h) => h.id === 'h1')!.preso = true;
    await questao(ctx, { a1: 1, a2: 1, a3: 1, a4: 1 });

    expect(ctx.segredo.acertosDesdeContagio).toBe(1);
    // Presa, ela não ganha poder (regra atual).
    expect(ctx.segredo.poderes?.some((p) => p.alunoId === 'a1')).toBeFalsy();
  });

  it('o acerto da contagiada não conta para o primordial', async () => {
    const ctx = vilaComAmeacas({ status: 'QUESTAO_ATIVA', reais: 4 });
    await questao(ctx, { a1: 3, a2: 1, a3: 1, a4: 1 });
    expect(ctx.segredo.acertosDesdeContagio ?? 0).toBe(0);
  });

  it('contagiada nunca contagia (SO_ORIGINAL), nem com saldo', async () => {
    const ctx = vilaComAmeacas({ status: 'QUESTAO_ATIVA', reais: 4 });
    ctx.segredo.acertosDesdeContagio = 5;
    await questao(ctx, { a1: 3, a2: 1, a3: 1, a4: 1 });

    const painel = await ctx.service.painel('a2', 'p1');
    expect(painel.poder?.CONTAGIO).toBe(false);
    expect(painel.contagioAcertos).toBeUndefined();
    const erro = await ctx.service
      .usarPoder('a2', 'p1', { poder: 'CONTAGIO' })
      .catch((e: unknown) => e);
    expect((erro as BadRequestException).getResponse()).toMatchObject({
      code: 'SO_ORIGINAL',
    });
  });
});

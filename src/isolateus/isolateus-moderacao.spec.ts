import { UnprocessableEntityException } from '@nestjs/common';
import { ISOLATEUS } from './entities/isolateus-match.entity';
import { vilaComAmeacas } from './isolateus-vila.fixture-spec';

/**
 * Moderação nos textos livres do Isolateus (028 §1): o debate da Quarentena e o
 * Sinal Interceptado. Palavrão não é gravado e custa XP só ao falante, sem
 * nada mudar no doc público (a penalidade é silenciosa).
 */
describe('Isolateus — moderação do debate e do Sinal Interceptado', () => {
  const debateAberto = () => vilaComAmeacas({ status: 'QUARENTENA_DEBATE' });

  /** Um habitante fora da vila (h3 abduzido) com a questão aberta. */
  const sinalAberto = () => {
    const ctx = vilaComAmeacas({ status: 'QUESTAO_ATIVA' });
    ctx.partida.habitantes.find((h) => h.id === 'h3')!.vivo = false;
    return ctx;
  };

  it('palavrão no debate não é gravado e devolve 422 MENSAGEM_BLOQUEADA', async () => {
    const ctx = debateAberto();
    const erro = await ctx.service
      .debater('a3', 'p1', 'seu merda')
      .catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(UnprocessableEntityException);
    expect((erro as UnprocessableEntityException).getResponse()).toMatchObject({
      code: 'MENSAGEM_BLOQUEADA',
    });
    expect(ctx.partida.debate).toEqual([]);
  });

  it('a penalidade cai só no falante, com o motivo do Isolateus', async () => {
    const ctx = debateAberto();
    await ctx.service.debater('a3', 'p1', 'seu merda').catch(() => null);

    expect(ctx.penalizar).toHaveBeenCalledTimes(1);
    expect(ctx.penalizar).toHaveBeenCalledWith(
      't1',
      'a3',
      ISOLATEUS.PENALIDADE_XP,
      'ISOLATEUS_MODERACAO',
    );
    expect(ISOLATEUS.PENALIDADE_XP).toBe(1000);
  });

  it('palavrão no sinal não entra nos rumores', async () => {
    const ctx = sinalAberto();
    const erro = await ctx.service
      .sinalDeRadio('a3', 'p1', 'p0rra, vão pra Saúde')
      .catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(UnprocessableEntityException);
    expect(ctx.partida.rumores).toEqual([]);
    expect(ctx.penalizar).toHaveBeenCalledWith(
      't1',
      'a3',
      ISOLATEUS.PENALIDADE_XP,
      'ISOLATEUS_MODERACAO',
    );
  });

  it('nenhum campo público muda: sem card, Diário ou Esperança', async () => {
    const ctx = debateAberto();
    await ctx.service.debater('a3', 'p1', 'seu merda').catch(() => null);
    const sinal = sinalAberto();
    await sinal.service.sinalDeRadio('a3', 'p1', 'merda').catch(() => null);

    for (const c of [ctx, sinal]) {
      const publicos = (c.repo.commitPartida as jest.Mock).mock.calls.map(
        (call: unknown[]) => call[1] as Record<string, unknown>,
      );
      expect(publicos.every((p) => !p || !Object.keys(p).length)).toBe(true);
      expect(c.partida.acontecimentos).toEqual([]);
      expect(c.partida.esperanca).toBe(ISOLATEUS.ESPERANCA_INICIAL);
    }
  });

  it('partida casual também penaliza', async () => {
    const ctx = debateAberto();
    ctx.partida.valeRanking = false;
    await ctx.service.debater('a3', 'p1', 'seu merda').catch(() => null);
    expect(ctx.penalizar).toHaveBeenCalledTimes(1);
  });

  it('sem turma, não há o que debitar (e a mensagem continua barrada)', async () => {
    const ctx = debateAberto();
    ctx.partida.turmaId = undefined;
    const erro = await ctx.service
      .debater('a3', 'p1', 'seu merda')
      .catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(UnprocessableEntityException);
    expect(ctx.penalizar).not.toHaveBeenCalled();
    expect(ctx.partida.debate).toEqual([]);
  });

  it('texto limpo segue como hoje', async () => {
    const ctx = debateAberto();
    await ctx.service.debater('a3', 'p1', 'Eu estava na Saúde.');
    expect(ctx.partida.debate.map((m) => m.texto)).toEqual([
      'Eu estava na Saúde.',
    ]);

    const sinal = sinalAberto();
    await sinal.service.sinalDeRadio('a3', 'p1', 'A resposta é a B');
    expect(sinal.partida.rumores.map((r) => r.texto)).toEqual([
      'A resposta é a B',
    ]);
    expect(ctx.penalizar).not.toHaveBeenCalled();
    expect(sinal.penalizar).not.toHaveBeenCalled();
  });
});

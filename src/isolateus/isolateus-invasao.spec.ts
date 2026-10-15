import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { SETOR_IDS } from './isolateus.data';
import { vilaComAmeacas } from './isolateus-vila.fixture-spec';

/**
 * A invasão forçada (028 §2): a Ameaça presa declara de noite que vai romper a
 * Quarentena; a questão do dia decide se ela foge.
 *
 * Cenário base: a original `a1`/`h1` está presa e a contagiada `a2`/`h2`
 * continua livre (só há preso com a partida em andamento depois de um
 * Contágio). `a3..a5` são aldeões.
 */
function comPresa(opts: Parameters<typeof vilaComAmeacas>[0] = {}) {
  const ctx = vilaComAmeacas({ status: 'DESLOCAMENTO', ...opts });
  ctx.partida.habitantes.find((h) => h.id === 'h1')!.preso = true;
  return ctx;
}

describe('Isolateus — declaração da invasão', () => {
  it('a Ameaça presa declara de noite; o cofre guarda o aluno', async () => {
    const ctx = comPresa();
    await ctx.service.declararInvasao('a1', 'p1');
    expect(ctx.segredo.invasoesNoite).toEqual(['a1']);
  });

  it('declarar de novo é idempotente', async () => {
    const ctx = comPresa();
    await ctx.service.declararInvasao('a1', 'p1');
    await ctx.service.declararInvasao('a1', 'p1');
    expect(ctx.segredo.invasoesNoite).toEqual(['a1']);
  });

  it('nada vai ao doc público na declaração', async () => {
    const ctx = comPresa();
    const antes = JSON.stringify(ctx.partida);
    await ctx.service.declararInvasao('a1', 'p1');
    expect(JSON.stringify(ctx.partida)).toBe(antes);
    const publicos = (ctx.repo.commitPartida as jest.Mock).mock.calls.map(
      (c: unknown[]) => c[1] as Record<string, unknown>,
    );
    expect(publicos.every((p) => !Object.keys(p ?? {}).length)).toBe(true);
  });

  it('não infla o contador da noite: o preso não é esperado para fechá-la', async () => {
    const ctx = comPresa();
    await ctx.service.declararInvasao('a1', 'p1');
    expect(ctx.segredo.confirmacoesNoite).toEqual([]);
    expect(ctx.partida.movimentosRecebidos).toBe(0);
    expect(ctx.partida.status).toBe('DESLOCAMENTO');
  });

  it('só de noite', async () => {
    const ctx = comPresa({ status: 'RESULTADO_RODADA' });
    await expect(
      ctx.service.declararInvasao('a1', 'p1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('aldeão preso ou abduzido: 403', async () => {
    const ctx = comPresa();
    ctx.partida.habitantes.find((h) => h.id === 'h3')!.preso = true;
    ctx.partida.habitantes.find((h) => h.id === 'h4')!.vivo = false;
    for (const aluno of ['a3', 'a4', 'a5']) {
      await expect(
        ctx.service.declararInvasao(aluno, 'p1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('Ameaça livre: 400 (ela já está na vila)', async () => {
    const ctx = comPresa();
    await expect(
      ctx.service.declararInvasao('a2', 'p1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('o painel da Ameaça presa diz se a invasão está disponível e se foi declarada', async () => {
    const ctx = comPresa();
    expect((await ctx.service.painel('a1', 'p1')).invasao).toEqual({
      disponivel: true,
      declarada: false,
    });
    await ctx.service.declararInvasao('a1', 'p1');
    expect((await ctx.service.painel('a1', 'p1')).invasao).toEqual({
      disponivel: false,
      declarada: true,
    });
    // De dia não há o que declarar.
    ctx.partida.status = 'RESULTADO_RODADA';
    ctx.segredo.invasoesNoite = [];
    expect((await ctx.service.painel('a1', 'p1')).invasao).toEqual({
      disponivel: false,
      declarada: false,
    });
  });

  it('Ameaça livre e aldeão não recebem o campo', async () => {
    const ctx = comPresa();
    expect(await ctx.service.painel('a2', 'p1')).not.toHaveProperty('invasao');
    ctx.partida.habitantes.find((h) => h.id === 'h3')!.preso = true;
    expect(await ctx.service.painel('a3', 'p1')).not.toHaveProperty('invasao');
  });
});

describe('Isolateus — a invasão é disputa e abre a questão', () => {
  const ALERTA = 'Algo tenta romper a Quarentena!';

  it('noite só com invasão abre a questão, com o alerta anônimo', async () => {
    const ctx = comPresa();
    await ctx.service.declararInvasao('a1', 'p1');
    await ctx.service.pularFase('prof', 'p1');

    expect(ctx.partida.status).toBe('QUESTAO_ATIVA');
    expect(ctx.partida.alerta?.tipo).toBe('INVASAO');
    expect(ctx.partida.alerta?.texto).toContain(ALERTA);
    expect(ctx.partida.alerta?.texto).not.toContain('Real 1');
  });

  it('sem invasão, a noite calma continua sem questão', async () => {
    const ctx = comPresa();
    await ctx.service.pularFase('prof', 'p1');
    expect(ctx.partida.status).toBe('RESULTADO_RODADA');
  });

  it('com abdução, a mesma questão decide tudo e o alerta ganha a linha', async () => {
    const ctx = comPresa();
    ctx.segredo.acoesRodada = [
      { alunoId: 'a2', acao: { tipo: 'ABDUZIR', alvoId: 'h3' } },
    ];
    await ctx.service.declararInvasao('a1', 'p1');
    await ctx.service.pularFase('prof', 'p1');

    expect(ctx.partida.status).toBe('QUESTAO_ATIVA');
    expect(ctx.partida.questaoIndex).toBe(0);
    expect(ctx.partida.alerta?.tipo).toBe('ABDUCAO');
    expect(ctx.partida.alerta?.texto).toContain('Abdução');
    expect(ctx.partida.alerta?.texto).toContain(ALERTA);
    expect(ctx.partida.alerta?.texto).not.toContain('Real 1');
  });

  it('o amanhecer não esquece a declaração antes da questão', async () => {
    const ctx = comPresa();
    await ctx.service.declararInvasao('a1', 'p1');
    await ctx.service.pularFase('prof', 'p1');
    expect(ctx.segredo.invasoesNoite).toEqual(['a1']);
  });
});

describe('Isolateus — resolução da invasão e fuga', () => {
  const CONTIDA = 'A Quarentena resistiu: a vila conteve a invasão.';
  const FUGA = 'Real 1 rompeu a Quarentena e voltou à vila!';

  afterEach(() => jest.restoreAllMocks());

  /** Presa declara, a noite fecha e a questão abre (correta = 1). */
  async function invasaoNoAr(opts: Parameters<typeof comPresa>[0] = {}) {
    const ctx = comPresa(opts);
    await ctx.service.declararInvasao('a1', 'p1');
    await ctx.service.pularFase('prof', 'p1');
    expect(ctx.partida.status).toBe('QUESTAO_ATIVA');
    return ctx;
  }

  async function responder(
    ctx: ReturnType<typeof comPresa>,
    respostas: Record<string, number>,
  ) {
    for (const [alunoId, alt] of Object.entries(respostas)) {
      await ctx.service.responder(alunoId, 'p1', alt);
    }
  }

  const h1 = (ctx: ReturnType<typeof comPresa>) =>
    ctx.partida.habitantes.find((h) => h.id === 'h1')!;
  const textos = (ctx: ReturnType<typeof comPresa>) =>
    ctx.partida.acontecimentos.map((a) => a.texto);

  it('a Ameaça errou: contida, com o mesmo texto da vila protegida', async () => {
    const ctx = await invasaoNoAr();
    await responder(ctx, { a1: 0, a2: 0, a3: 0, a4: 0, a5: 0 });

    expect(ctx.partida.status).toBe('RESULTADO_RODADA');
    expect(h1(ctx).preso).toBe(true);
    expect(textos(ctx)).toContain(CONTIDA);
    expect(ctx.partida.resumoRodada?.texto).toContain(CONTIDA);
  });

  it('a Ameaça acertou e a maioria da vila acertou: contida', async () => {
    const ctx = await invasaoNoAr();
    await responder(ctx, { a1: 1, a2: 0, a3: 1, a4: 1, a5: 0 });

    expect(h1(ctx).preso).toBe(true);
    expect(textos(ctx)).toContain(CONTIDA);
    expect(textos(ctx)).not.toContain(FUGA);
  });

  it('a Ameaça acertou e a maioria da vila errou: fuga para um setor sorteado', async () => {
    const ctx = await invasaoNoAr();
    jest.spyOn(Math, 'random').mockReturnValue(0.999);
    await responder(ctx, { a1: 1, a2: 1, a3: 1, a4: 0, a5: 0 });

    expect(h1(ctx)).toMatchObject({
      preso: false,
      vivo: true,
      setorId: SETOR_IDS[SETOR_IDS.length - 1],
    });
    expect(ctx.partida.acontecimentos.at(-1)).toMatchObject({
      tipo: 'INVASAO',
      texto: FUGA,
    });
    expect(ctx.partida.resumoRodada?.texto).toContain(FUGA);
  });

  it('sem aldeão real na vila, a Ameaça que acerta foge', async () => {
    const ctx = await invasaoNoAr({ reais: 3 });
    ctx.partida.habitantes.find((h) => h.id === 'h3')!.vivo = false;
    await responder(ctx, { a1: 1, a2: 0 });
    expect(h1(ctx).preso).toBe(false);
  });

  it('a questão espera a resposta de quem tentou fugir', async () => {
    const ctx = await invasaoNoAr();
    await responder(ctx, { a2: 1, a3: 0, a4: 0, a5: 0 });
    expect(ctx.partida.status).toBe('QUESTAO_ATIVA');
    await responder(ctx, { a1: 1 });
    expect(ctx.partida.status).toBe('RESULTADO_RODADA');
  });

  it('invasoesNoite é zerado na resolução', async () => {
    const ctx = await invasaoNoAr();
    await responder(ctx, { a1: 0, a2: 0, a3: 0, a4: 0, a5: 0 });
    expect(ctx.segredo.invasoesNoite).toEqual([]);
  });

  it('a fugitiva volta a ser Ameaça livre: aliada, age e ganha poder', async () => {
    const ctx = await invasaoNoAr();
    await responder(ctx, { a1: 1, a2: 1, a3: 0, a4: 0, a5: 0 });
    expect(h1(ctx).preso).toBe(false);

    // Aliada da outra Ameaça, sem o campo de invasão.
    expect((await ctx.service.painel('a2', 'p1')).aliados).toContain('Real 1');
    expect(await ctx.service.painel('a1', 'p1')).not.toHaveProperty('invasao');

    // Age na noite seguinte.
    ctx.partida.status = 'DESLOCAMENTO';
    ctx.partida.rodada = 1;
    await ctx.service.acaoAmeaca('a1', 'p1', { tipo: 'AGUARDAR' });
    expect(ctx.segredo.acoesRodada?.some((j) => j.alunoId === 'a1')).toBe(true);

    // Acertando a próxima questão, ganha poder como antes de ser presa.
    ctx.partida.status = 'QUESTAO_ATIVA';
    await responder(ctx, { a1: 1, a2: 0, a3: 0, a4: 0, a5: 0 });
    expect(ctx.segredo.poderes?.some((p) => p.alunoId === 'a1')).toBe(true);
  });

  it('a fugitiva conta no veredito: prendê-la de novo não encerra a partida se outra está livre', async () => {
    const ctx = await invasaoNoAr();
    await responder(ctx, { a1: 1, a2: 1, a3: 0, a4: 0, a5: 0 });
    // Agora são duas livres: prender a contagiada não encerra mais.
    ctx.partida.habitantes.find((h) => h.id === 'h2')!.preso = true;
    expect(ctx.partida.status).not.toBe('ENCERRADO');
    expect(h1(ctx).preso).toBe(false);
  });

  it('fuga e resgate na mesma questão: vale a fuga, o resgate falha sem ser consumido por ela', async () => {
    const ctx = comPresa();
    ctx.partida.resgatePendente = true;
    await ctx.service.declararInvasao('a1', 'p1');
    await ctx.service.pularFase('prof', 'p1');
    // Resgate e fuga usam a maioria dos aldeões: a vila errar derruba o
    // resgate e solta a invasora.
    await responder(ctx, { a1: 1, a2: 0, a3: 0, a4: 0, a5: 1 });

    expect(h1(ctx).preso).toBe(false);
    expect(ctx.partida.status).toBe('RESULTADO_RODADA');
    expect(textos(ctx)).toContain('O resgate fracassou.');
  });
});

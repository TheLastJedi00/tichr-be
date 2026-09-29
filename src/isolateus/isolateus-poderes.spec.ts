import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { vilaComAmeacas } from './isolateus-vila.fixture-spec';

/** Cada aluno responde a alternativa dada (a correta é a 1). */
async function responder(
  ctx: ReturnType<typeof vilaComAmeacas>,
  respostas: Record<string, number>,
) {
  for (const [alunoId, alt] of Object.entries(respostas)) {
    await ctx.service.responder(alunoId, 'p1', alt);
  }
}

describe('Isolateus — o voto da Ameaça não defende a vila', () => {
  it('o voto da Ameaça fica fora da apuração da questão', async () => {
    // Aldeões: 2 na correta (1), 1 na errada (0). A Ameaça também vota na 0.
    // Contando o voto dela, dava empate 2×2 e o desempate pelo menor índice
    // entregava a vítima. Sem ele, a vila defende.
    const ctx = vilaComAmeacas({
      status: 'QUESTAO_ATIVA',
      reais: 4,
      ameacas: ['a1'],
    });
    ctx.segredo.acoesRodada = [
      { alunoId: 'a1', acao: { tipo: 'ABDUZIR', alvoId: 'h3' } },
    ];
    await responder(ctx, { a1: 0, a2: 1, a3: 1, a4: 0 });

    expect(ctx.partida.status).toBe('RESULTADO_RODADA');
    expect(ctx.partida.resumoRodada?.defendida).toBe(true);
    expect(ctx.partida.habitantes.find((h) => h.id === 'h3')!.vivo).toBe(true);
  });

  it('o avanço rápido continua esperando a resposta dela (o contador não a denuncia)', async () => {
    const ctx = vilaComAmeacas({
      status: 'QUESTAO_ATIVA',
      reais: 4,
      ameacas: ['a1'],
    });
    ctx.segredo.acoesRodada = [
      { alunoId: 'a1', acao: { tipo: 'ABDUZIR', alvoId: 'h3' } },
    ];
    await responder(ctx, { a2: 1, a3: 1, a4: 1 });
    expect(ctx.partida.status).toBe('QUESTAO_ATIVA');

    await responder(ctx, { a1: 3 });
    expect(ctx.partida.status).toBe('RESULTADO_RODADA');
  });

  it('ela responde e pontua pelo acerto como qualquer um', async () => {
    const ctx = vilaComAmeacas({ status: 'QUESTAO_ATIVA', ameacas: ['a1'] });
    await ctx.service.responder('a1', 'p1', 1);
    expect(ctx.segredo.pontos['a1']).toBeGreaterThan(0);
  });

  it('o painel da Ameaça não traz mais o gabarito', async () => {
    const ctx = vilaComAmeacas({ status: 'QUESTAO_ATIVA', ameacas: ['a1'] });
    const painel = await ctx.service.painel('a1', 'p1');
    expect(painel.papel).toBe('AMEACA');
    expect(painel).not.toHaveProperty('corretaIndex');
  });
});

describe('Isolateus — acertou, ganhou um poder', () => {
  it('a Ameaça que acerta ganha um poder, tenha a vila acertado ou não', async () => {
    const ctx = vilaComAmeacas({ status: 'QUESTAO_ATIVA', reais: 4 });
    ctx.segredo.acoesRodada = [
      { alunoId: 'a1', acao: { tipo: 'ABDUZIR', alvoId: 'h3' } },
    ];
    // a1 acerta, a2 (contagiada) erra; a vila erra.
    await responder(ctx, { a1: 1, a2: 3, a3: 3, a4: 3 });

    expect(ctx.partida.resumoRodada?.defendida).toBe(false);
    expect(ctx.segredo.poderes).toEqual([{ alunoId: 'a1', ganhoNaRodada: 0 }]);
  });

  it('as duas Ameaças acertando ganham um poder cada', async () => {
    const ctx = vilaComAmeacas({ status: 'QUESTAO_ATIVA', reais: 4 });
    await responder(ctx, { a1: 1, a2: 1, a3: 1, a4: 1 });
    expect(ctx.segredo.poderes).toEqual([
      { alunoId: 'a1', ganhoNaRodada: 0 },
      { alunoId: 'a2', ganhoNaRodada: 0 },
    ]);
  });

  it('aldeão que acerta não ganha poder', async () => {
    const ctx = vilaComAmeacas({ status: 'QUESTAO_ATIVA', ameacas: ['a1'] });
    await responder(ctx, { a1: 3, a2: 1, a3: 1, a4: 1, a5: 1 });
    expect(ctx.segredo.poderes ?? []).toEqual([]);
  });

  it('um poder por acerto, sem acúmulo: o novo substitui o que sobrou', async () => {
    const ctx = vilaComAmeacas({ status: 'QUESTAO_ATIVA', ameacas: ['a1'] });
    ctx.partida.rodada = 3;
    ctx.segredo.poderes = [{ alunoId: 'a1', ganhoNaRodada: 2 }];
    await responder(ctx, { a1: 1, a2: 1, a3: 1, a4: 1, a5: 1 });
    expect(ctx.segredo.poderes).toEqual([{ alunoId: 'a1', ganhoNaRodada: 3 }]);
  });
});

describe('Isolateus — usar um poder', () => {
  function comPoder(opts: Parameters<typeof vilaComAmeacas>[0] = {}) {
    const ctx = vilaComAmeacas({ status: 'RESULTADO_RODADA', ...opts });
    ctx.segredo.poderes = [
      { alunoId: 'a1', ganhoNaRodada: 0 },
      { alunoId: 'a2', ganhoNaRodada: 0 },
    ];
    return ctx;
  }

  it('aldeão não usa poder', async () => {
    const ctx = comPoder();
    await expect(
      ctx.service.usarPoder('a3', 'p1', { poder: 'DELIRIO' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('sem poder disponível é recusado', async () => {
    const ctx = comPoder();
    ctx.segredo.poderes = [];
    await expect(
      ctx.service.usarPoder('a1', 'p1', { poder: 'DELIRIO' }),
    ).rejects.toMatchObject({ response: { code: 'SEM_PODER' } });
  });

  it('usar consome o poder e NÃO escreve nada no doc público', async () => {
    const ctx = comPoder();
    const antes = JSON.stringify(ctx.partida);
    await ctx.service.usarPoder('a1', 'p1', { poder: 'DELIRIO' });

    expect(JSON.stringify(ctx.partida)).toBe(antes);
    expect(ctx.segredo.poderes).toEqual([{ alunoId: 'a2', ganhoNaRodada: 0 }]);
    expect(ctx.segredo.delirioPendente).toBe(true);
    await expect(
      ctx.service.usarPoder('a1', 'p1', { poder: 'DELIRIO' }),
    ).rejects.toMatchObject({ response: { code: 'SEM_PODER' } });
  });

  it('só a Ameaça original contagia', async () => {
    const ctx = comPoder();
    await expect(
      ctx.service.usarPoder('a2', 'p1', { poder: 'CONTAGIO' }),
    ).rejects.toMatchObject({ response: { code: 'SO_ORIGINAL' } });
    await ctx.service.usarPoder('a1', 'p1', { poder: 'CONTAGIO' });
    expect(ctx.segredo.contagioPendente).toBe(true);
  });

  it('Contágio sem aldeão real livre é recusado', async () => {
    const ctx = comPoder({ reais: 3, npcs: 2 });
    ctx.partida.habitantes.find((h) => h.id === 'h3')!.vivo = false;
    await expect(
      ctx.service.usarPoder('a1', 'p1', { poder: 'CONTAGIO' }),
    ).rejects.toMatchObject({ response: { code: 'SEM_ALVO' } });
  });

  it('Controle Mental exige um habitante na vila que não seja Ameaça', async () => {
    const ctx = comPoder({ npcs: 2 });
    for (const alvoId of [undefined, 'h1', 'h2', 'xx']) {
      await expect(
        ctx.service.usarPoder('a1', 'p1', { poder: 'CONTROLE', alvoId }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    // NPC vale: o controle não distingue real de virtual.
    await ctx.service.usarPoder('a1', 'p1', { poder: 'CONTROLE', alvoId: 'n1' });
    expect(ctx.segredo.controles).toEqual([
      { ameacaAlunoId: 'a1', habitanteId: 'n1', rodada: 1 },
    ]);
  });

  it('Controle escolhido durante a noite vale para ESTA noite', async () => {
    const ctx = comPoder({ status: 'DESLOCAMENTO' });
    await ctx.service.usarPoder('a1', 'p1', { poder: 'CONTROLE', alvoId: 'h3' });
    expect(ctx.segredo.controles?.[0].rodada).toBe(0);
  });

  it('o poder não usado expira no fechamento da noite seguinte', async () => {
    const ctx = vilaComAmeacas({ status: 'DESLOCAMENTO', reais: 5 });
    ctx.partida.rodada = 1;
    ctx.segredo.poderes = [{ alunoId: 'a1', ganhoNaRodada: 0 }];
    for (const a of ['a3', 'a4', 'a5']) await ctx.service.confirmarPosicao(a, 'p1');
    await ctx.service.acaoAmeaca('a1', 'p1', { tipo: 'AGUARDAR' });
    await ctx.service.acaoAmeaca('a2', 'p1', { tipo: 'AGUARDAR' });

    expect(ctx.partida.status).toBe('RESULTADO_RODADA'); // a noite fechou
    expect(ctx.segredo.poderes).toEqual([]);
  });
});

describe('Isolateus — o painel da Ameaça', () => {
  it('mostra o poder disponível e o que ela pode escolher', async () => {
    const ctx = vilaComAmeacas({ status: 'RESULTADO_RODADA' });
    ctx.segredo.poderes = [
      { alunoId: 'a1', ganhoNaRodada: 0 },
      { alunoId: 'a2', ganhoNaRodada: 0 },
    ];
    expect((await ctx.service.painel('a1', 'p1')).poder).toEqual({
      CONTROLE: true,
      CONTAGIO: true,
      DELIRIO: true,
    });
    // A contagiada não contagia.
    expect((await ctx.service.painel('a2', 'p1')).poder).toEqual({
      CONTROLE: true,
      CONTAGIO: false,
      DELIRIO: true,
    });
  });

  it('sem poder, o campo vem nulo; aldeão nem recebe o campo', async () => {
    const ctx = vilaComAmeacas({ status: 'RESULTADO_RODADA' });
    expect((await ctx.service.painel('a1', 'p1')).poder).toBeNull();
    expect(await ctx.service.painel('a3', 'p1')).not.toHaveProperty('poder');
  });

  it('lista as aliadas pelo codinome — e o aldeão não vê nada disso', async () => {
    const ctx = vilaComAmeacas();
    expect((await ctx.service.painel('a1', 'p1')).aliados).toEqual(['Real 2']);
    expect((await ctx.service.painel('a2', 'p1')).aliados).toEqual(['Real 1']);
    expect(await ctx.service.painel('a3', 'p1')).not.toHaveProperty('aliados');
  });

  it('a fileira ao vivo do setor de onde ela age (posição do cofre)', async () => {
    const ctx = vilaComAmeacas({
      posicoes: { h1: 'energia', h3: 'comunicacao', h4: 'energia' },
    });
    await ctx.service.mover('a3', 'p1', 'energia'); // chegou nesta noite
    const painel = await ctx.service.painel('a1', 'p1');
    expect(painel.fileira?.setorId).toBe('energia');
    expect(painel.fileira?.habitantes.map((h) => h.id).sort()).toEqual([
      'h3',
      'h4',
    ]);
  });
});

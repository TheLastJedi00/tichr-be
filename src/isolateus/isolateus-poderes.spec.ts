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

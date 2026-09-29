import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ISOLATEUS } from './entities/isolateus-match.entity';
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

describe('Isolateus — Controle Mental', () => {
  /** a1 controla o h3 nesta noite (rodada 0). */
  function controlando(posicoes: Record<string, string>, controlado = 'h3') {
    const ctx = vilaComAmeacas({ ameacas: ['a1'], npcs: 1, posicoes });
    ctx.segredo.controles = [
      { ameacaAlunoId: 'a1', habitanteId: controlado, rodada: 0 },
    ];
    return ctx;
  }

  it('a sabotagem cai no setor do CONTROLADO, não no dela', async () => {
    const ctx = controlando({ h1: 'energia', h3: 'saude' });
    await ctx.service.acaoAmeaca('a1', 'p1', { tipo: 'SABOTAR' });
    expect(ctx.segredo.acoesDaNoite()[0].acao).toEqual({
      tipo: 'SABOTAR',
      setorId: 'saude',
    });
  });

  it('funciona com NPC controlado', async () => {
    const ctx = controlando({ h1: 'energia', n1: 'comercio' }, 'n1');
    await ctx.service.acaoAmeaca('a1', 'p1', { tipo: 'SABOTAR' });
    expect(ctx.segredo.acoesDaNoite()[0].acao.setorId).toBe('comercio');
  });

  it('abdução presencial alcança quem está com o controlado — e nunca ele', async () => {
    const ctx = controlando({ h1: 'energia', h3: 'saude', h4: 'saude', h5: 'energia' });
    await expect(
      ctx.service.acaoAmeaca('a1', 'p1', { tipo: 'ABDUZIR', alvoId: 'h5' }),
    ).rejects.toMatchObject({ response: { code: 'FORA_DE_ALCANCE' } });
    await expect(
      ctx.service.acaoAmeaca('a1', 'p1', { tipo: 'ABDUZIR', alvoId: 'h3' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await ctx.service.acaoAmeaca('a1', 'p1', { tipo: 'ABDUZIR', alvoId: 'h4' });
    expect(ctx.segredo.acoesDaNoite()[0].acao.alvoId).toBe('h4');
  });

  it('às cegas, o setor "visível" passa a ser o do controlado', async () => {
    const ctx = controlando({ h1: 'energia', h3: 'saude' });
    await expect(
      ctx.service.acaoAmeaca('a1', 'p1', { tipo: 'ABDUZIR', setorId: 'saude' }),
    ).rejects.toMatchObject({ response: { code: 'SETOR_VISIVEL' } });
    await ctx.service.acaoAmeaca('a1', 'p1', { tipo: 'ABDUZIR', setorId: 'energia' });
    expect(ctx.segredo.acoesDaNoite()[0].acao.setorId).toBe('energia');
  });

  it('o controle de outra rodada não vale: ela age do próprio setor', async () => {
    const ctx = controlando({ h1: 'energia', h3: 'saude' });
    ctx.segredo.controles![0].rodada = 1; // é para a próxima noite
    await ctx.service.acaoAmeaca('a1', 'p1', { tipo: 'SABOTAR' });
    expect(ctx.segredo.acoesDaNoite()[0].acao.setorId).toBe('energia');
  });

  it('o controlado não fica sabendo: o painel dele não muda', async () => {
    const ctx = controlando({ h1: 'energia', h3: 'saude' });
    const painel = await ctx.service.painel('a3', 'p1');
    expect(painel).toEqual({
      papel: 'ALDEAO',
      habitanteId: 'h3',
      vivo: true,
      preso: false,
      setorId: 'saude',
    });
  });

  it('o painel da Ameaça mostra o controlado e a fileira do setor dele', async () => {
    const ctx = controlando({ h1: 'energia', h3: 'saude', h4: 'saude' });
    const painel = await ctx.service.painel('a1', 'p1');
    expect(painel.controle).toEqual({ habitanteId: 'h3', nome: 'Real 3' });
    expect(painel.fileira?.setorId).toBe('saude');
    expect(painel.fileira?.habitantes.map((h) => h.id)).toEqual(['h3', 'h4']);
  });

  it('preso na Quarentena do dia de controle, o controlado conta como inocente', async () => {
    const ctx = controlando({ h1: 'energia', h3: 'saude' });
    ctx.partida.status = 'QUARENTENA_VOTO';
    ctx.partida.quarentenaRodada = 0;
    for (const a of ['a1', 'a2', 'a3', 'a4', 'a5']) {
      await ctx.service.votarSuspeito(a, 'p1', 'h3');
    }
    expect(ctx.partida.vereditoQuarentena?.eraAmeaca).toBe(false);
    expect(ctx.partida.esperanca).toBe(100 - ISOLATEUS.DANO_INOCENTE);
    expect(ctx.partida.status).toBe('RESULTADO_RODADA');
  });
});

describe('Isolateus — Contágio', () => {
  /** Uma Ameaça só (a1), contágio escolhido, noite pronta para fechar. */
  function comContagio(opts: Parameters<typeof vilaComAmeacas>[0] = {}) {
    const ctx = vilaComAmeacas({ ameacas: ['a1'], reais: 5, npcs: 2, ...opts });
    ctx.segredo.contagioPendente = true;
    return ctx;
  }
  async function fecharNoite(ctx: ReturnType<typeof comContagio>) {
    for (const a of ['a2', 'a3', 'a4', 'a5']) {
      await ctx.service.confirmarPosicao(a, 'p1');
    }
    await ctx.service.acaoAmeaca('a1', 'p1', { tipo: 'AGUARDAR' });
  }

  it('ao amanhecer, um aldeão REAL vira Ameaça — nunca um NPC', async () => {
    const ctx = comContagio();
    await fecharNoite(ctx);

    const novas = ctx.segredo.ameacasIds().filter((a) => a !== 'a1');
    expect(novas).toHaveLength(1);
    expect(['a2', 'a3', 'a4', 'a5']).toContain(novas[0]);
    expect(ctx.segredo.contagioPendente).toBe(false);
    // O contagiado descobre pelo painel (polling) — e vê a aliada.
    const painel = await ctx.service.painel(novas[0], 'p1');
    expect(painel.papel).toBe('AMEACA');
    expect(painel.aliados).toEqual(['Real 1']);
  });

  it('a Esperança cai 10, sem card e sem Diário, e nada público denuncia o contágio', async () => {
    const ctx = comContagio();
    await fecharNoite(ctx);

    expect(ctx.partida.esperanca).toBe(100 - ISOLATEUS.DANO_CONTAGIO);
    // O único evento da noite calma é o de sempre.
    expect(ctx.partida.acontecimentos.map((a) => a.tipo)).toEqual(['ESPERA']);
    expect(JSON.stringify(ctx.partida)).not.toMatch(/cont[aá]gi|ameacas/i);
  });

  it('com sabotagem na mesma noite, os danos chegam juntos', async () => {
    const ctx = comContagio({ posicoes: { h1: 'energia' } });
    for (const a of ['a2', 'a3', 'a4', 'a5']) {
      await ctx.service.confirmarPosicao(a, 'p1');
    }
    await ctx.service.acaoAmeaca('a1', 'p1', { tipo: 'SABOTAR' });
    expect(ctx.partida.esperanca).toBe(
      100 - ISOLATEUS.DANO_SABOTAGEM - ISOLATEUS.DANO_CONTAGIO,
    );
  });

  it('Esperança zerada pelo contágio entrega a partida à Ameaça', async () => {
    const ctx = comContagio();
    ctx.partida.esperanca = ISOLATEUS.DANO_CONTAGIO;
    await fecharNoite(ctx);
    expect(ctx.partida.status).toBe('ENCERRADO');
    expect(ctx.partida.veredito?.lado).toBe('AMEACA');
  });

  it('original presa antes do amanhecer: o contágio não acontece', async () => {
    const ctx = comContagio();
    // Presa no dia anterior, com a noite ainda por fechar (pelo relógio).
    ctx.partida.habitantes.find((h) => h.id === 'h1')!.preso = true;
    await ctx.service.pularFase('prof', 'p1');
    expect(ctx.segredo.ameacasIds()).toEqual(['a1']);
    expect(ctx.segredo.contagioPendente).toBe(false);
    expect(ctx.partida.esperanca).toBe(100);
  });

  it('na noite seguinte, a noite só fecha cedo com a jogada do contagiado também', async () => {
    const ctx = comContagio();
    await fecharNoite(ctx);
    const contagiado = ctx.segredo.ameacasIds().find((a) => a !== 'a1')!;
    await ctx.service.pularFase('prof', 'p1'); // janela de decisão → noite 2
    expect(ctx.partida.status).toBe('DESLOCAMENTO');

    const aldeoes = ['a2', 'a3', 'a4', 'a5'].filter((a) => a !== contagiado);
    for (const a of aldeoes) await ctx.service.confirmarPosicao(a, 'p1');
    await ctx.service.acaoAmeaca('a1', 'p1', { tipo: 'AGUARDAR' });
    await ctx.service.confirmarPosicao(contagiado, 'p1');
    expect(ctx.partida.status).toBe('DESLOCAMENTO');
    await ctx.service.acaoAmeaca(contagiado, 'p1', { tipo: 'AGUARDAR' });
    expect(ctx.partida.status).toBe('RESULTADO_RODADA');
  });
});

import { vilaComAmeacas } from './isolateus-vila.fixture-spec';

/**
 * Spec 025 §6.3: o resgate pendente gera a questão do dia e dá certo se mais
 * da metade das respostas dos ALDEÕES reais na vila estiverem certas — as
 * Ameaças ficam fora da conta, como na apuração da defesa.
 *
 * Vila: a1/h1 é a Ameaça; a2..a4 são aldeões na vila; h5 foi abduzido. A
 * alternativa correta das questões do fixture é a 1.
 */
const CERTA = 1;
const ERRADA = 0;

function vila() {
  const ctx = vilaComAmeacas({
    status: 'QUESTAO_ATIVA',
    ameacas: ['a1'],
    reais: 5,
  });
  ctx.partida.habitantes.find((h) => h.id === 'h5')!.vivo = false;
  ctx.partida.resgatePendente = true;
  return ctx;
}

/** Cada aluno responde; quem não está no mapa não responde. A questão fecha no fim. */
async function responder(
  ctx: ReturnType<typeof vila>,
  respostas: Record<string, number>,
) {
  for (const [aluno, alt] of Object.entries(respostas)) {
    await ctx.service.responder(aluno, 'p1', alt);
  }
  if (ctx.partida.status === 'QUESTAO_ATIVA') {
    await ctx.service.pularFase('prof', 'p1');
  }
}

const textos = (ctx: ReturnType<typeof vila>) =>
  ctx.partida.acontecimentos.map((e) => e.texto);

describe('Isolateus — a questão do resgate (Task 17)', () => {
  it('maioria dos aldeões certa: abre a votação do resgate', async () => {
    const ctx = vila();
    await responder(ctx, { a1: ERRADA, a2: CERTA, a3: CERTA, a4: ERRADA });
    expect(ctx.partida.status).toBe('RESGATE_VOTO');
    expect(ctx.partida.resgatePendente).toBe(false);
    expect(ctx.partida.votosResgateRecebidos).toBe(0);
    expect(ctx.partida.faseIniciadaEm).toBeTruthy();
  });

  it('metade não é maioria: o resgate fracassa e ninguém volta', async () => {
    const ctx = vila();
    await responder(ctx, { a2: CERTA, a3: ERRADA });
    expect(ctx.partida.status).toBe('RESULTADO_RODADA');
    expect(textos(ctx)).toContain('O resgate fracassou.');
    expect(ctx.partida.habitantes.find((h) => h.id === 'h5')!.vivo).toBe(false);
  });

  it('o acerto da Ameaça não conta para o resgate', async () => {
    // Com a Ameaça na conta seriam 2 de 3 certas; sem ela, 1 de 2.
    const ctx = vila();
    await responder(ctx, { a1: CERTA, a2: CERTA, a3: ERRADA });
    expect(ctx.partida.status).toBe('RESULTADO_RODADA');
    expect(textos(ctx)).toContain('O resgate fracassou.');
  });

  it('ninguém respondeu: fracassa', async () => {
    const ctx = vila();
    await responder(ctx, {});
    expect(ctx.partida.status).toBe('RESULTADO_RODADA');
    expect(textos(ctx)).toContain('O resgate fracassou.');
  });

  it('abdução e resgate na mesma questão: um acerto repele e resgata', async () => {
    const ctx = vila();
    ctx.segredo.acoesRodada = [
      { alunoId: 'a1', acao: { tipo: 'ABDUZIR', alvoId: 'h4' } },
    ];
    await responder(ctx, { a1: ERRADA, a2: CERTA, a3: CERTA, a4: CERTA });
    expect(ctx.partida.habitantes.find((h) => h.id === 'h4')!.vivo).toBe(true);
    expect(ctx.partida.status).toBe('RESGATE_VOTO');
  });

  it('sem resgate pendente, a questão segue como sempre', async () => {
    const ctx = vila();
    ctx.partida.resgatePendente = false;
    ctx.partida.reparoSetorId = 'energia';
    ctx.partida.setores.find((s) => s.id === 'energia')!.intacto = false;
    await responder(ctx, { a2: CERTA, a3: CERTA, a4: CERTA });
    expect(ctx.partida.status).toBe('RESULTADO_RODADA');
    expect(textos(ctx)).not.toContain('O resgate fracassou.');
  });
});

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { vilaComAmeacas } from './isolateus-vila.fixture-spec';

/**
 * Spec 025 §6.1–6.2: o resgate é organizado à noite, de dentro do Setor de
 * Saúde, e só vale no amanhecer se a Saúde estiver de pé e com 2+ habitantes.
 *
 * Vila: a1/h1 é a Ameaça (Energia); h2 está na Saúde com o NPC n1; h5 foi
 * abduzido numa noite anterior.
 */
function vila(posicoes: Record<string, string> = {}, npcs = 1) {
  const ctx = vilaComAmeacas({
    ameacas: ['a1'],
    reais: 5,
    npcs,
    posicoes: { h1: 'energia', h2: 'saude', n1: 'saude', ...posicoes },
  });
  ctx.partida.habitantes.find((h) => h.id === 'h5')!.vivo = false;
  return ctx;
}

/** Os aldeões na vila confirmam e a Ameaça joga: a noite fecha. */
async function fecharNoite(
  ctx: ReturnType<typeof vila>,
  jogada: { tipo: 'AGUARDAR' | 'SABOTAR' } = { tipo: 'AGUARDAR' },
) {
  for (const a of ['a2', 'a3', 'a4']) {
    await ctx.service.confirmarPosicao(a, 'p1');
  }
  await ctx.service.acaoAmeaca('a1', 'p1', jogada);
}

const codigo = (e: unknown) =>
  ((e as BadRequestException).getResponse() as { code?: string }).code;

describe('Isolateus — organizar o resgate (Task 16)', () => {
  it('quem está na Saúde organiza; nada aparece no doc público durante a noite', async () => {
    const ctx = vila();
    const eventos = ctx.partida.acontecimentos.length;
    await ctx.service.organizarResgate('a2', 'p1');
    expect(ctx.segredo.resgateNoite).toEqual({ alunoId: 'a2' });
    expect(ctx.partida.resgatePendente).toBe(false);
    expect(ctx.partida.acontecimentos).toHaveLength(eventos);
  });

  it('403 fora da Saúde', async () => {
    const ctx = vila();
    const e = await ctx.service.organizarResgate('a3', 'p1').catch((x) => x);
    expect(e).toBeInstanceOf(ForbiddenException);
    expect(codigo(e)).toBe('FORA_DA_SAUDE');
  });

  it('403 com a Saúde em ruínas', async () => {
    const ctx = vila();
    ctx.partida.setores.find((s) => s.id === 'saude')!.intacto = false;
    const e = await ctx.service.organizarResgate('a2', 'p1').catch((x) => x);
    expect(e).toBeInstanceOf(ForbiddenException);
    expect(codigo(e)).toBe('SAUDE_EM_RUINAS');
  });

  it('400 sem ninguém para resgatar', async () => {
    const ctx = vila();
    ctx.partida.habitantes.find((h) => h.id === 'h5')!.vivo = true;
    const e = await ctx.service.organizarResgate('a2', 'p1').catch((x) => x);
    expect(e).toBeInstanceOf(BadRequestException);
    expect(codigo(e)).toBe('SEM_RESGATAVEIS');
  });

  it('400 com um resgate já organizado na noite', async () => {
    const ctx = vila({ h3: 'saude' });
    await ctx.service.organizarResgate('a2', 'p1');
    const e = await ctx.service.organizarResgate('a3', 'p1').catch((x) => x);
    expect(e).toBeInstanceOf(BadRequestException);
    expect(codigo(e)).toBe('RESGATE_USADO');
  });

  it('presos também podem ser resgatados', async () => {
    const ctx = vila();
    const h5 = ctx.partida.habitantes.find((h) => h.id === 'h5')!;
    h5.vivo = true;
    h5.preso = true;
    await expect(
      ctx.service.organizarResgate('a2', 'p1'),
    ).resolves.toBeDefined();
  });

  it('no amanhecer, com 2+ na Saúde (o NPC conta): vira pendente e gera questão', async () => {
    const ctx = vila();
    await ctx.service.organizarResgate('a2', 'p1');
    await fecharNoite(ctx);
    expect(ctx.partida.resgatePendente).toBe(true);
    expect(ctx.partida.status).toBe('QUESTAO_ATIVA');
    expect(ctx.partida.acontecimentos.map((e) => e.texto)).toContain(
      'Um resgate foi organizado no Setor de Saúde.',
    );
    expect(ctx.segredo.resgateNoite ?? null).toBeNull();
  });

  it('cancelado sem gente suficiente na Saúde', async () => {
    const ctx = vila({}, 0); // sem NPC: só o organizador na Saúde
    await ctx.service.organizarResgate('a2', 'p1');
    await fecharNoite(ctx);
    expect(ctx.partida.resgatePendente).toBe(false);
    expect(ctx.partida.acontecimentos.map((e) => e.texto)).toContain(
      'O resgate no Setor de Saúde não reuniu gente suficiente.',
    );
  });

  it('cancelado se o organizador saiu da Saúde', async () => {
    const ctx = vila({ h3: 'saude' });
    await ctx.service.organizarResgate('a2', 'p1');
    await ctx.service.mover('a2', 'p1', 'comercio');
    await fecharNoite(ctx);
    expect(ctx.partida.resgatePendente).toBe(false);
  });

  it('cancelado se a Saúde caiu na mesma noite', async () => {
    const ctx = vila({ h1: 'saude' });
    await ctx.service.organizarResgate('a2', 'p1');
    await fecharNoite(ctx, { tipo: 'SABOTAR' });
    expect(ctx.partida.resgatePendente).toBe(false);
  });
});

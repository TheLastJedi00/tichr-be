import { HttpException } from '@nestjs/common';
import { amanhecer, vilaComAmeacas } from './isolateus-vila.fixture-spec';

/**
 * 036 — Movimentação contínua. Na noite, o habitante atravessa portas quantas
 * vezes quiser, sempre para um vizinho do setor ATUAL, e a troca é pública na
 * hora. Vale onde ele está quando o relógio zera.
 */

const codigo = (e: unknown) =>
  ((e as HttpException).getResponse() as { code?: string }).code;

let agora = Date.parse('2026-11-23T12:00:00.000Z');
const avancar = (ms: number) => {
  agora += ms;
  jest.setSystemTime(agora);
};
beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  agora = Date.parse('2026-11-23T12:00:00.000Z');
  jest.setSystemTime(agora);
});
afterEach(() => jest.useRealTimers());

describe('Isolateus 036 — travessia contínua (Task 2)', () => {
  it('a troca é pública na hora: nada de destino guardado no cofre', async () => {
    const ctx = vilaComAmeacas();
    await ctx.service.mover('a3', 'p1', 'energia');
    expect(ctx.setorDe('h3')).toBe('energia');
    expect(ctx.segredo.posicoesNoite ?? []).toEqual([]);
    expect(ctx.partida.deslocamentosNoite ?? []).toEqual([]);
    expect((await ctx.service.painel('a3', 'p1')).setorId).toBe('energia');
  });

  it('grava o habitante novo numa transação, sobre a leitura fresca', async () => {
    const ctx = vilaComAmeacas();
    const repo = ctx.repo as unknown as { transacao: jest.Mock };
    await ctx.service.mover('a3', 'p1', 'energia');
    expect(repo.transacao).toHaveBeenCalled();
  });

  it('atravessa várias portas na mesma noite, de vizinho em vizinho', async () => {
    const ctx = vilaComAmeacas();
    await ctx.service.mover('a3', 'p1', 'energia');
    avancar(1_000);
    await ctx.service.mover('a3', 'p1', 'comunicacao');
    avancar(1_000);
    await ctx.service.mover('a3', 'p1', 'abastecimento');
    expect(ctx.setorDe('h3')).toBe('abastecimento');
  });

  it('SEM_ESTRADA é contado do setor atual, não de onde a noite começou', async () => {
    const ctx = vilaComAmeacas();
    await ctx.service.mover('a3', 'p1', 'energia');
    avancar(1_000);
    // Comércio é vizinho da Segurança (onde a noite começou), não da Energia.
    const e = await ctx.service
      .mover('a3', 'p1', 'comercio')
      .catch((x: unknown) => x);
    expect(codigo(e)).toBe('SEM_ESTRADA');
    expect(ctx.setorDe('h3')).toBe('energia');
  });

  it('mover para o próprio setor é "ficar": conta a ação, não anda', async () => {
    const ctx = vilaComAmeacas();
    await ctx.service.mover('a3', 'p1', 'seguranca');
    expect(ctx.setorDe('h3')).toBe('seguranca');
    expect(ctx.segredo.confirmacoesNoite).toContain('a3');
  });

  it('atravessar conta como ação da noite (ociosidade, 032)', async () => {
    const ctx = vilaComAmeacas();
    await ctx.service.mover('a3', 'p1', 'energia');
    expect(ctx.segredo.confirmacoesNoite).toEqual(['a3']);
    expect(ctx.partida.movimentosRecebidos).toBe(1);
  });

  it('429 MOVER_RAPIDO abaixo de 1s entre duas travessias', async () => {
    const ctx = vilaComAmeacas();
    await ctx.service.mover('a3', 'p1', 'energia');
    avancar(500);
    const e = await ctx.service
      .mover('a3', 'p1', 'seguranca')
      .catch((x: unknown) => x);
    expect((e as HttpException).getStatus()).toBe(429);
    expect(codigo(e)).toBe('MOVER_RAPIDO');
    expect(ctx.setorDe('h3')).toBe('energia');
  });

  it('noite fechada entre a leitura e a transação: 400 FORA_DA_NOITE', async () => {
    const ctx = vilaComAmeacas();
    type Fn = (p: unknown, s: unknown) => unknown;
    const repo = ctx.repo as unknown as { transacao: jest.Mock };
    const original = repo.transacao.getMockImplementation() as (
      id: string,
      fn: Fn,
    ) => Promise<unknown>;
    repo.transacao.mockImplementation((id: string, fn: Fn) =>
      original(id, (p, s) => {
        (p as { status: string }).status = 'QUESTAO_ATIVA';
        return fn(p, s);
      }),
    );
    const e = await ctx.service
      .mover('a3', 'p1', 'energia')
      .catch((x: unknown) => x);
    expect(codigo(e)).toBe('FORA_DA_NOITE');
  });

  it('pausada, ninguém atravessa', async () => {
    const ctx = vilaComAmeacas();
    ctx.partida.pausadaEm = new Date().toISOString();
    await expect(
      ctx.service.mover('a3', 'p1', 'energia'),
    ).rejects.toBeDefined();
    expect(ctx.setorDe('h3')).toBe('seguranca');
  });

  it('quem organizou o reparo fica travado no setor (POSICAO_TRAVADA)', async () => {
    const ctx = vilaComAmeacas();
    ctx.partida.setores.find((s) => s.id === 'seguranca')!.intacto = false;
    await ctx.service.declararReparo('a3', 'p1');
    avancar(1_000);
    const e = await ctx.service
      .mover('a3', 'p1', 'energia')
      .catch((x: unknown) => x);
    expect(codigo(e)).toBe('POSICAO_TRAVADA');
    expect((e as HttpException).getResponse()).toMatchObject({
      motivo: 'REPARO',
    });
    // Ficar continua valendo.
    await ctx.service.mover('a3', 'p1', 'seguranca');
  });

  it('quem organizou o resgate fica travado na Saúde', async () => {
    const ctx = vilaComAmeacas({ posicoes: { h3: 'saude' } });
    ctx.partida.habitantes.find((h) => h.id === 'h5')!.vivo = false;
    await ctx.service.organizarResgate('a3', 'p1');
    avancar(1_000);
    const e = await ctx.service
      .mover('a3', 'p1', 'comercio')
      .catch((x: unknown) => x);
    expect(codigo(e)).toBe('POSICAO_TRAVADA');
    expect((e as HttpException).getResponse()).toMatchObject({
      motivo: 'RESGATE',
    });
  });

  it('a trava vale só para a noite: some no amanhecer', async () => {
    const ctx = vilaComAmeacas();
    ctx.partida.setores.find((s) => s.id === 'seguranca')!.intacto = false;
    await ctx.service.declararReparo('a3', 'p1');
    await amanhecer(ctx);
    expect(ctx.segredo.travasNoite ?? []).toEqual([]);
  });

  it('o amanhecer mantém as posições do instante em que a noite fechou', async () => {
    const ctx = vilaComAmeacas({ npcs: 0 });
    await ctx.service.mover('a3', 'p1', 'energia');
    avancar(1_000);
    await ctx.service.mover('a4', 'p1', 'comercio');
    await amanhecer(ctx);
    expect(ctx.partida.status).toBe('QUESTAO_ATIVA');
    expect(ctx.setorDe('h3')).toBe('energia');
    expect(ctx.setorDe('h4')).toBe('comercio');
    // Nada para animar no amanhecer: as travessias já aconteceram ao vivo.
    expect(ctx.partida.ultimosDeslocamentos).toBeNull();
  });
});

describe('Isolateus 036 — ações sobre a posição ao vivo (Task 3)', () => {
  it('a Ameaça que sabota fica travada no setor (motivo ACAO)', async () => {
    const ctx = vilaComAmeacas({ posicoes: { h1: 'energia' } });
    await ctx.service.acaoAmeaca('a1', 'p1', { tipo: 'SABOTAR' });
    avancar(1_000);
    const e = await ctx.service
      .mover('a1', 'p1', 'seguranca')
      .catch((x: unknown) => x);
    expect(codigo(e)).toBe('POSICAO_TRAVADA');
    expect((e as HttpException).getResponse()).toMatchObject({
      motivo: 'ACAO',
    });
  });

  it('abduzir (presencial ou às cegas) também trava; aguardar não', async () => {
    const ctx = vilaComAmeacas({ posicoes: { h1: 'energia', h3: 'energia' } });
    await ctx.service.acaoAmeaca('a1', 'p1', { tipo: 'ABDUZIR', alvoId: 'h3' });
    await ctx.service.acaoAmeaca('a2', 'p1', { tipo: 'AGUARDAR' });
    avancar(1_000);
    await expect(
      ctx.service.mover('a1', 'p1', 'seguranca'),
    ).rejects.toMatchObject({ response: { code: 'POSICAO_TRAVADA' } });
    await ctx.service.mover('a2', 'p1', 'energia');
    expect(ctx.setorDe('h2')).toBe('energia');
  });

  it('superpoder escolhido na noite também trava a Ameaça', async () => {
    const ctx = vilaComAmeacas({ ameacas: ['a1'] });
    ctx.segredo.energiaAlien = { a1: 3 };
    await ctx.service.usarPoder('a1', 'p1', { poder: 'DELIRIO' });
    await expect(
      ctx.service.mover('a1', 'p1', 'energia'),
    ).rejects.toMatchObject({ response: { code: 'POSICAO_TRAVADA' } });
  });

  it('a sabotagem vale no setor onde a Ameaça estava ao agir', async () => {
    const ctx = vilaComAmeacas({ ameacas: ['a1'] });
    await ctx.service.mover('a1', 'p1', 'energia');
    avancar(1_000);
    await ctx.service.acaoAmeaca('a1', 'p1', { tipo: 'SABOTAR' });
    await amanhecer(ctx);
    expect(ctx.partida.setores.find((s) => s.id === 'energia')!.intacto).toBe(
      false,
    );
  });

  it('abdução presencial: o alvo fixado no toque vale mesmo que ele fuja depois', async () => {
    const ctx = vilaComAmeacas({ ameacas: ['a1'] });
    await ctx.service.acaoAmeaca('a1', 'p1', { tipo: 'ABDUZIR', alvoId: 'h3' });
    avancar(1_000);
    await ctx.service.mover('a3', 'p1', 'energia'); // a vítima atravessa
    await amanhecer(ctx);
    expect(ctx.partida.alerta?.tipo).toBe('ABDUCAO');
    expect(ctx.segredo.acoesDaNoite()[0].acao).toEqual({
      tipo: 'ABDUZIR',
      alvoId: 'h3',
    });
  });

  it('alvo que já atravessou a porta: 400 ALVO_SAIU, e a Ameaça tenta outro', async () => {
    const ctx = vilaComAmeacas({ ameacas: ['a1'] });
    await ctx.service.mover('a3', 'p1', 'energia');
    const e = await ctx.service
      .acaoAmeaca('a1', 'p1', { tipo: 'ABDUZIR', alvoId: 'h3' })
      .catch((x: unknown) => x);
    expect(codigo(e)).toBe('ALVO_SAIU');
    expect(ctx.segredo.acoesDaNoite()).toEqual([]);
    await ctx.service.acaoAmeaca('a1', 'p1', { tipo: 'ABDUZIR', alvoId: 'h4' });
    expect(ctx.segredo.acoesDaNoite()).toHaveLength(1);
  });

  it('o alvo é validado sobre a leitura fresca (transação)', async () => {
    const ctx = vilaComAmeacas({ ameacas: ['a1'] });
    type Fn = (p: unknown, s: unknown) => unknown;
    const repo = ctx.repo as unknown as { transacao: jest.Mock };
    const original = repo.transacao.getMockImplementation() as (
      id: string,
      fn: Fn,
    ) => Promise<unknown>;
    // Entre a leitura do comando e a transação, a vítima atravessou.
    repo.transacao.mockImplementationOnce((id: string, fn: Fn) =>
      original(id, (p, s) => {
        ctx.partida.habitantes.find((h) => h.id === 'h3')!.setorId = 'energia';
        return fn(p, s);
      }),
    );
    const e = await ctx.service
      .acaoAmeaca('a1', 'p1', { tipo: 'ABDUZIR', alvoId: 'h3' })
      .catch((x: unknown) => x);
    expect(codigo(e)).toBe('ALVO_SAIU');
  });

  it('a Quarentena se convoca de onde se está agora: quem chegou à Comunicação pode', async () => {
    const ctx = vilaComAmeacas({ posicoes: { h3: 'energia' } });
    await ctx.service.mover('a3', 'p1', 'comunicacao');
    await ctx.service.convocarQuarentena('p1', 'a3');
    expect(ctx.segredo.quarentenaConvocadaNoite).toEqual({
      habitanteId: 'h3',
    });
  });
});

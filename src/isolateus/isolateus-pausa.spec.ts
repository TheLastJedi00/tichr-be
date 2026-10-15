import { BadRequestException, NotFoundException } from '@nestjs/common';
import { vilaComAmeacas } from './isolateus-vila.fixture-spec';

/** Pausar e retomar o Isolateus (028 §4). Relógio mockado. */
describe('Isolateus — pausa', () => {
  const T0 = Date.parse('2026-10-15T12:00:00.000Z');
  let agora = T0;
  beforeEach(() => {
    agora = T0;
    jest.spyOn(Date, 'now').mockImplementation(() => agora);
  });
  afterEach(() => jest.restoreAllMocks());

  const noite = () => {
    const ctx = vilaComAmeacas({ status: 'DESLOCAMENTO' });
    ctx.partida.faseIniciadaEm = new Date(T0 - 20_000).toISOString();
    ctx.segredo.agendaNpc = [
      {
        habitanteId: 'n1',
        para: 'saude',
        em: new Date(T0 + 5_000).toISOString(),
      },
      { habitanteId: 'n2', para: null, em: new Date(T0 + 9_000).toISOString() },
    ];
    return ctx;
  };

  it('pausar grava pausadaEm; de novo é idempotente', async () => {
    const ctx = noite();
    await ctx.service.pausar('prof', 'p1');
    expect(ctx.partida.pausadaEm).toBe(new Date(T0).toISOString());
    agora = T0 + 3_000;
    await ctx.service.pausar('prof', 'p1');
    expect(ctx.partida.pausadaEm).toBe(new Date(T0).toISOString());
  });

  it('retomar empurra faseIniciadaEm e a agenda dos NPCs pelo tempo pausado', async () => {
    const ctx = noite();
    await ctx.service.pausar('prof', 'p1');
    agora = T0 + 45_000;
    await ctx.service.retomar('prof', 'p1');

    expect(ctx.partida.pausadaEm).toBeNull();
    expect(ctx.partida.faseIniciadaEm).toBe(
      new Date(T0 - 20_000 + 45_000).toISOString(),
    );
    expect(ctx.segredo.agendaNpc?.map((a) => a.em)).toEqual([
      new Date(T0 + 5_000 + 45_000).toISOString(),
      new Date(T0 + 9_000 + 45_000).toISOString(),
    ]);
  });

  it('retomada, a fase tem exatamente o tempo que faltava (o prazo não vence)', async () => {
    const ctx = noite(); // 20s corridos de 60s
    await ctx.service.pausar('prof', 'p1');
    agora = T0 + 120_000; // pausada por 2 min
    await ctx.service.retomar('prof', 'p1');
    await ctx.service.resolverPorTempo('p1', { professorId: 'prof' });
    expect(ctx.partida.status).toBe('DESLOCAMENTO');
  });

  it('fora de andamento: 400; só o dono', async () => {
    for (const status of ['LOBBY', 'ENCERRADO'] as const) {
      const ctx = vilaComAmeacas({ status });
      await expect(ctx.service.pausar('prof', 'p1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
    const ctx = noite();
    await expect(ctx.service.pausar('x', 'p1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(ctx.service.retomar('x', 'p1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('Isolateus — pausada, comando dá 409', () => {
  const pausada = (status: Parameters<typeof vilaComAmeacas>[0]['status']) => {
    const ctx = vilaComAmeacas({ status });
    ctx.partida.pausadaEm = new Date().toISOString();
    return ctx;
  };
  const PAUSADA = { status: 409, response: { code: 'PARTIDA_PAUSADA' } };

  it('comandos de aluno: 409', async () => {
    const noite = pausada('DESLOCAMENTO');
    await expect(
      noite.service.mover('a3', 'p1', 'seguranca'),
    ).rejects.toMatchObject(PAUSADA);
    await expect(
      noite.service.acaoAmeaca('a1', 'p1', { tipo: 'AGUARDAR' }),
    ).rejects.toMatchObject(PAUSADA);
    await expect(
      noite.service.confirmarPosicao('a3', 'p1'),
    ).rejects.toMatchObject(PAUSADA);

    const questao = pausada('QUESTAO_ATIVA');
    await expect(
      questao.service.responder('a3', 'p1', 1),
    ).rejects.toMatchObject(PAUSADA);

    const debate = pausada('QUARENTENA_DEBATE');
    await expect(
      debate.service.debater('a3', 'p1', 'oi'),
    ).rejects.toMatchObject(PAUSADA);

    const presa = pausada('DESLOCAMENTO');
    presa.partida.habitantes.find((h) => h.id === 'h1')!.preso = true;
    await expect(
      presa.service.declararInvasao('a1', 'p1'),
    ).rejects.toMatchObject(PAUSADA);
  });

  it('comandos do professor: 409 (encerrar inclusive)', async () => {
    const ctx = pausada('DESLOCAMENTO');
    await expect(ctx.service.pularFase('prof', 'p1')).rejects.toMatchObject(
      PAUSADA,
    );
    await expect(
      ctx.service.delirioDoProfessor('prof', 'p1'),
    ).rejects.toMatchObject(PAUSADA);
    await expect(
      ctx.service.encerrarPeloProfessor('prof', 'p1'),
    ).rejects.toMatchObject(PAUSADA);
  });

  it('o /tempo pausado não fecha a fase, nem com o prazo vencido', async () => {
    const ctx = pausada('DESLOCAMENTO');
    ctx.partida.faseIniciadaEm = new Date(
      Date.now() - 10 * 60_000,
    ).toISOString();
    await expect(
      ctx.service.resolverPorTempo('p1', { alunoId: 'a3' }),
    ).rejects.toMatchObject(PAUSADA);
    expect(ctx.partida.status).toBe('DESLOCAMENTO');
  });

  it('a leitura (painel) continua valendo', async () => {
    const ctx = pausada('DESLOCAMENTO');
    await expect(ctx.service.painel('a3', 'p1')).resolves.toMatchObject({
      papel: 'ALDEAO',
    });
  });
});

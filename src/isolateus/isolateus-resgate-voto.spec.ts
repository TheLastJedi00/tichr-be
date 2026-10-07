import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ISOLATEUS } from './entities/isolateus-match.entity';
import { vilaComAmeacas } from './isolateus-vila.fixture-spec';

/**
 * Spec 025 §6.4: a turma conquistou o resgate e vota quem volta — abduzido ou
 * preso. Só os reais na vila votam; empate e urna vazia viram sorteio.
 *
 * Vila: a1/h1 é a Ameaça; h2, h3 na vila; h4 está preso; h5 foi abduzido.
 * Votam a1, a2 e a3 (os reais na vila).
 */
function vila(ameacas = ['a1']) {
  const ctx = vilaComAmeacas({ status: 'RESGATE_VOTO', ameacas, reais: 5 });
  ctx.partida.rodada = 1;
  ctx.partida.esperanca = 50;
  ctx.partida.habitantes.find((h) => h.id === 'h4')!.preso = true;
  ctx.partida.habitantes.find((h) => h.id === 'h5')!.vivo = false;
  return ctx;
}

const habitante = (ctx: ReturnType<typeof vila>, id: string) =>
  ctx.partida.habitantes.find((h) => h.id === id)!;

describe('Isolateus — a votação do resgate (Task 18)', () => {
  it('conta o voto (só a contagem é pública)', async () => {
    const ctx = vila();
    await ctx.service.votarResgate('a2', 'p1', 'h5');
    expect(ctx.partida.votosResgateRecebidos).toBe(1);
  });

  it('um voto por aluno', async () => {
    const ctx = vila();
    await ctx.service.votarResgate('a2', 'p1', 'h5');
    await expect(ctx.service.votarResgate('a2', 'p1', 'h4')).resolves.toEqual({
      registrado: false,
    });
  });

  it('só se vota em quem saiu da vila', async () => {
    const ctx = vila();
    await expect(
      ctx.service.votarResgate('a2', 'p1', 'h3'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('quem está fora da vila não vota', async () => {
    const ctx = vila();
    await expect(
      ctx.service.votarResgate('a5', 'p1', 'h4'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('fora da votação, 400', async () => {
    const ctx = vila();
    ctx.partida.status = 'RESULTADO_RODADA';
    await expect(
      ctx.service.votarResgate('a2', 'p1', 'h5'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('todos os reais votaram: o mais votado volta vivo, livre e na Saúde', async () => {
    const ctx = vila();
    await ctx.service.votarResgate('a1', 'p1', 'h4');
    await ctx.service.votarResgate('a2', 'p1', 'h5');
    await ctx.service.votarResgate('a3', 'p1', 'h5');

    const h5 = habitante(ctx, 'h5');
    expect(h5).toMatchObject({ vivo: true, preso: false, setorId: 'saude' });
    expect(habitante(ctx, 'h4').preso).toBe(true);
    expect(ctx.partida.esperanca).toBe(50 + ISOLATEUS.BONUS_RESGATE);
    expect(ctx.partida.resgateResultado).toEqual({
      habitanteId: 'h5',
      nome: h5.nome,
    });
    expect(ctx.partida.acontecimentos.at(-1)!.texto).toBe(
      `${h5.nome} foi resgatado e voltou à vila.`,
    );
    expect(ctx.partida.status).toBe('RESULTADO_RODADA');
    expect(ctx.partida.faseIniciadaEm).toBeTruthy();
  });

  it('a Esperança não passa do teto', async () => {
    const ctx = vila();
    ctx.partida.esperanca = ISOLATEUS.ESPERANCA_INICIAL - 5;
    await ctx.service.votarResgate('a2', 'p1', 'h5');
    await ctx.service.pularFase('prof', 'p1');
    expect(ctx.partida.esperanca).toBe(ISOLATEUS.ESPERANCA_INICIAL);
  });

  it('empate: sorteio entre os empatados', async () => {
    const voltaram = new Set<string>();
    for (let rep = 0; rep < 30; rep++) {
      const ctx = vila();
      await ctx.service.votarResgate('a2', 'p1', 'h4');
      await ctx.service.votarResgate('a3', 'p1', 'h5');
      await ctx.service.pularFase('prof', 'p1');
      const quem = ['h4', 'h5'].filter((id) => {
        const h = habitante(ctx, id);
        return h.vivo && !h.preso;
      });
      expect(quem).toHaveLength(1);
      voltaram.add(quem[0]);
    }
    expect(voltaram.size).toBe(2);
  });

  it('ninguém votou: alguém de fora volta mesmo assim (o resgate foi conquistado)', async () => {
    const ctx = vila();
    await ctx.service.pularFase('prof', 'p1');
    const voltou = ['h4', 'h5'].filter((id) => {
      const h = habitante(ctx, id);
      return h.vivo && !h.preso;
    });
    expect(voltou).toHaveLength(1);
  });

  it('o prazo vence pelo relógio como as outras fases', async () => {
    const ctx = vila();
    ctx.partida.faseIniciadaEm = new Date(
      Date.now() - ISOLATEUS.RESGATE_VOTO_MS - 1,
    ).toISOString();
    await ctx.service.votarResgate('a2', 'p1', 'h5');
    await ctx.service.resolverPorTempo('p1', { professorId: 'prof' });
    expect(ctx.partida.status).toBe('RESULTADO_RODADA');
  });

  it('Ameaça presa resgatada volta livre — e a partida segue', async () => {
    const ctx = vila(['a1', 'a4']); // h4 (preso) é uma Ameaça
    await ctx.service.votarResgate('a1', 'p1', 'h4');
    await ctx.service.votarResgate('a2', 'p1', 'h4');
    await ctx.service.votarResgate('a3', 'p1', 'h4');
    expect(habitante(ctx, 'h4')).toMatchObject({ vivo: true, preso: false });
    expect(ctx.partida.status).toBe('RESULTADO_RODADA');
    const painel = await ctx.service.painel('a4', 'p1');
    expect(painel.papel).toBe('AMEACA');
  });

  it('o Delírio do professor remapeia votos e resultado do resgate', async () => {
    const ctx = vila();
    await ctx.service.votarResgate('a2', 'p1', 'h5');
    await ctx.service.delirioDoProfessor('prof', 'p1');
    const novoH5 = ctx.segredo.habitanteDe('a5')!;
    await ctx.service.votarResgate('a3', 'p1', novoH5);
    await ctx.service.votarResgate('a1', 'p1', novoH5);
    expect(ctx.partida.resgateResultado?.habitanteId).toBe(novoH5);
    expect(habitante(ctx, novoH5).vivo).toBe(true);
  });
});

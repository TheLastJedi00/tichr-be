import { ISOLATEUS } from './entities/isolateus-match.entity';
import { vilaComAmeacas } from './isolateus-vila.fixture-spec';

/**
 * Spec 030 §1: o ranking final revela quem era a Ameaça (a original e as
 * contagiadas). Só no encerramento — antes disso a camada pública não sabe.
 */
describe('Isolateus — revelação no ranking final', () => {
  async function prender(
    ctx: ReturnType<typeof vilaComAmeacas>,
    suspeito: string,
    votantes: string[],
  ) {
    ctx.partida.status = 'QUARENTENA_VOTO';
    ctx.partida.quarentenaRodada = ctx.partida.rodada;
    for (const a of votantes) {
      await ctx.service.votarSuspeito(a, 'p1', suspeito);
    }
  }

  const papelDe = (ctx: ReturnType<typeof vilaComAmeacas>, a: string) =>
    ctx.partida.rankingFinal.find((p) => p.alunoId === a)!.papel;

  it('vitória da vila: Alienígena na original, Contagiado na convertida, aldeões sem papel', async () => {
    const ctx = vilaComAmeacas({ reais: 5 });
    ctx.partida.habitantes.find((h) => h.id === 'h2')!.preso = true;
    await prender(ctx, 'h1', ['a1', 'a3', 'a4', 'a5']);

    expect(ctx.partida.veredito?.lado).toBe('VILA');
    expect(papelDe(ctx, 'a1')).toBe('ALIEN');
    expect(papelDe(ctx, 'a2')).toBe('CONTAGIADO');
    for (const a of ['a3', 'a4', 'a5']) expect(papelDe(ctx, a)).toBeUndefined();
  });

  it('vitória da Ameaça também revela', async () => {
    const ctx = vilaComAmeacas({ reais: 5 });
    ctx.partida.esperanca = ISOLATEUS.DANO_INOCENTE;
    await prender(ctx, 'h3', ['a1', 'a2', 'a3', 'a4', 'a5']);

    expect(ctx.partida.veredito?.lado).toBe('AMEACA');
    expect(papelDe(ctx, 'a1')).toBe('ALIEN');
    expect(papelDe(ctx, 'a2')).toBe('CONTAGIADO');
  });

  it('o professor encerrando também revela', async () => {
    const ctx = vilaComAmeacas({ reais: 4 });
    await ctx.service.encerrarPeloProfessor('prof', 'p1');

    expect(ctx.partida.status).toBe('ENCERRADO');
    expect(papelDe(ctx, 'a1')).toBe('ALIEN');
    expect(papelDe(ctx, 'a2')).toBe('CONTAGIADO');
  });

  it('cofre antigo, sem a lista de Ameaças, revela só a original', async () => {
    const ctx = vilaComAmeacas({ reais: 4 });
    ctx.segredo.ameacas = undefined;
    await ctx.service.encerrarPeloProfessor('prof', 'p1');

    expect(papelDe(ctx, 'a1')).toBe('ALIEN');
    expect(papelDe(ctx, 'a2')).toBeUndefined();
  });

  it('o log de pontuação continua com o codinome e sem papel', async () => {
    const ctx = vilaComAmeacas({ reais: 4 });
    await ctx.service.encerrarPeloProfessor('prof', 'p1');

    const log = ctx.partida.logPontuacao!.find((l) => l.alunoId === 'a1')!;
    expect(log.nome).toBe('Real 1');
    expect(log).not.toHaveProperty('papel');
  });
});

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

  it('cada linha traz o nome real do jogador, lido uma vez do cadastro da turma', async () => {
    const ctx = vilaComAmeacas({ reais: 3 });
    await ctx.service.encerrarPeloProfessor('prof', 'p1');

    const linha = (a: string) =>
      ctx.partida.rankingFinal.find((p) => p.alunoId === a)!;
    expect(linha('a1')).toMatchObject({ nome: 'Real 1', jogador: 'Aluno 1' });
    expect(linha('a2')).toMatchObject({ nome: 'Real 2', jogador: 'Aluno 2' });
    expect(linha('a3')).toMatchObject({ nome: 'Real 3', jogador: 'Aluno 3' });
    expect(ctx.findByTurma).toHaveBeenCalledTimes(1);
    expect(ctx.findByTurma).toHaveBeenCalledWith('t1');
  });

  it('partida sem turma encerra sem o nome real e sem erro', async () => {
    const ctx = vilaComAmeacas({ reais: 3 });
    ctx.partida.turmaId = undefined;
    await ctx.service.encerrarPeloProfessor('prof', 'p1');

    expect(ctx.partida.status).toBe('ENCERRADO');
    expect(ctx.findByTurma).not.toHaveBeenCalled();
    for (const p of ctx.partida.rankingFinal) {
      expect(p).not.toHaveProperty('jogador');
    }
  });

  it('aluno removido da turma fica sem o nome; os outros saem normais', async () => {
    const ctx = vilaComAmeacas({
      reais: 3,
      nomes: { a1: 'Ana', a3: 'Caio' },
    });
    await ctx.service.encerrarPeloProfessor('prof', 'p1');

    const linha = (a: string) =>
      ctx.partida.rankingFinal.find((p) => p.alunoId === a)!;
    expect(linha('a1').jogador).toBe('Ana');
    expect(linha('a2')).not.toHaveProperty('jogador');
    expect(linha('a3').jogador).toBe('Caio');
  });

  it('antes do encerramento, nenhuma escrita pública leva nome real ou papel', async () => {
    const ctx = vilaComAmeacas({ reais: 5 });
    ctx.partida.habitantes.find((h) => h.id === 'h2')!.preso = true;
    await prender(ctx, 'h3', ['a1', 'a3', 'a4', 'a5']); // inocente, segue o jogo

    expect(ctx.partida.status).not.toBe('ENCERRADO');
    const chamadas = (ctx.repo.commitPartida as jest.Mock).mock
      .calls as unknown[][];
    const escritas = chamadas.map((c) => JSON.stringify(c[1] ?? {}));
    for (const e of escritas) {
      expect(e).not.toContain('Aluno ');
      expect(e).not.toContain('"papel"');
    }
    expect(ctx.findByTurma).not.toHaveBeenCalled();
  });

  it('o log de pontuação continua com o codinome e sem papel', async () => {
    const ctx = vilaComAmeacas({ reais: 4 });
    await ctx.service.encerrarPeloProfessor('prof', 'p1');

    const log = ctx.partida.logPontuacao!.find((l) => l.alunoId === 'a1')!;
    expect(log.nome).toBe('Real 1');
    expect(log).not.toHaveProperty('papel');
  });
});

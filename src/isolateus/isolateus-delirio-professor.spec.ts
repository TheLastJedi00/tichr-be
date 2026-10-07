import { BadRequestException, NotFoundException } from '@nestjs/common';
import { vilaComAmeacas } from './isolateus-vila.fixture-spec';

/**
 * Spec 025 §7: o professor dispara o Delírio Coletivo a qualquer momento (anti-
 * trapaça) — mesma permutação do poder da Ameaça, mas com efeito imediato.
 */
function vila(status: Parameters<typeof vilaComAmeacas>[0]['status']) {
  const ctx = vilaComAmeacas({
    status,
    ameacas: ['a1'],
    reais: 4,
    npcs: 3,
    posicoes: { h1: 'energia', h2: 'saude', h3: 'comunicacao' },
  });
  ctx.partida.rodada = 2;
  return ctx;
}

/** Quem cada pessoa é, pelo vínculo (NPC pela ordem de criação). */
function retrato(ctx: ReturnType<typeof vila>) {
  return ctx.segredo.vinculos.map((v, i) => {
    const h = ctx.partida.habitantes.find((x) => x.id === v.habitanteId)!;
    return { quem: v.alunoId ?? `npc${i}`, id: h.id, nome: h.nome };
  });
}

describe('Isolateus — Delírio Coletivo pelo professor (Task 13)', () => {
  it('na hora: todos trocam de nome e de id, e os vínculos acompanham', async () => {
    const ctx = vila('RESULTADO_RODADA');
    const antes = retrato(ctx);
    await ctx.service.delirioDoProfessor('prof', 'p1');
    const depois = retrato(ctx);
    for (const d of depois) {
      const a = antes.find((x) => x.quem === d.quem)!;
      expect(d.nome).not.toBe(a.nome);
      expect(d.id).not.toBe(a.id);
    }
    expect(depois.map((d) => d.nome).sort()).toEqual(
      antes.map((a) => a.nome).sort(),
    );
  });

  it('o Diário anuncia o delírio com o mesmo texto do poder da Ameaça', async () => {
    const ctx = vila('DESLOCAMENTO');
    await ctx.service.delirioDoProfessor('prof', 'p1');
    const evento = ctx.partida.acontecimentos.at(-1)!;
    expect(evento.tipo).toBe('DELIRIO');
    expect(evento.texto).toBe(
      'Um delírio coletivo tomou a vila: ninguém mais atende pelo mesmo nome.',
    );
  });

  it('vale em qualquer fase de jogo', async () => {
    for (const status of [
      'DESLOCAMENTO',
      'QUESTAO_ATIVA',
      'RESULTADO_RODADA',
      'QUARENTENA_DEBATE',
      'QUARENTENA_VOTO',
    ] as const) {
      const ctx = vila(status);
      const nomes = ctx.partida.habitantes.map((h) => h.nome).join();
      await ctx.service.delirioDoProfessor('prof', 'p1');
      expect(ctx.partida.status).toBe(status);
      expect(ctx.partida.habitantes.map((h) => h.nome).join()).not.toBe(nomes);
    }
  });

  it('400 no lobby e depois do fim', async () => {
    for (const status of ['LOBBY', 'ENCERRADO'] as const) {
      const ctx = vila(status);
      await expect(
        ctx.service.delirioDoProfessor('prof', 'p1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('404 para quem não é dono da partida', async () => {
    const ctx = vila('DESLOCAMENTO');
    await expect(
      ctx.service.delirioDoProfessor('outro', 'p1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a posição da noite no cofre segue o habitante', async () => {
    const ctx = vila('DESLOCAMENTO');
    await ctx.service.mover('a2', 'p1', 'comercio');
    await ctx.service.delirioDoProfessor('prof', 'p1');
    const meuId = ctx.segredo.habitanteDe('a2')!;
    expect(ctx.segredo.posicoesNoite).toEqual([
      { habitanteId: meuId, setorId: 'comercio' },
    ]);
  });

  it('votos pendentes, convocador e bloqueio são remapeados', async () => {
    const ctx = vila('RESULTADO_RODADA');
    ctx.partida.convocadorBloqueado = { habitanteId: 'h4', ateRodada: 2 };
    await ctx.service.convocarQuarentena('p1', 'a3');
    await ctx.service.pularFase('prof', 'p1'); // abre a votação
    await ctx.service.votarSuspeito('a2', 'p1', 'h4');

    await ctx.service.delirioDoProfessor('prof', 'p1');

    const novoH3 = ctx.segredo.habitanteDe('a3')!;
    const novoH4 = ctx.segredo.habitanteDe('a4')!;
    expect(ctx.partida.quarentenaConvocadaPor?.habitanteId).toBe(novoH3);
    expect(ctx.partida.convocadorBloqueado?.habitanteId).toBe(novoH4);
    const votos = await ctx.repo.lerVotos('p1', 2);
    expect(votos).toEqual([{ rodada: 2, alunoId: 'a2', suspeitoId: novoH4 }]);
  });

  it('não consome o Delírio pendente de uma Ameaça', async () => {
    const ctx = vila('DESLOCAMENTO');
    ctx.segredo.delirioPendente = true;
    await ctx.service.delirioDoProfessor('prof', 'p1');
    expect(ctx.segredo.delirioPendente).toBe(true);
  });
});

import { ISOLATEUS } from './entities/isolateus-match.entity';
import { AcaoAmeacaDto } from './dto/acao-ameaca.dto';
import { vilaComAmeacas } from './isolateus-vila.fixture-spec';

/**
 * Spec 025 §5: a cada 3 noites, o setor de onde cada Ameaça age brilha no mapa
 * de todos — a menos que ela tenha tentado sabotar ou abduzir naquela noite.
 *
 * `rodada` é 0-indexada (o Diário diz "Noite rodada + 1"): a Noite 3 é a
 * `rodada` 2.
 */
const NOITE_3 = 2;

function vila(
  opts: { ameacas?: string[]; posicoes?: Record<string, string> } = {},
) {
  const ctx = vilaComAmeacas({
    ameacas: opts.ameacas ?? ['a1'],
    reais: 4,
    posicoes: opts.posicoes ?? { h1: 'energia', h3: 'comercio' },
  });
  ctx.partida.rodada = NOITE_3;
  return ctx;
}

/** Os aldeões confirmam e cada Ameaça faz a jogada dada; a noite fecha. */
async function fecharNoite(
  ctx: ReturnType<typeof vila>,
  jogadas: Record<string, AcaoAmeacaDto>,
) {
  for (const a of ['a2', 'a3', 'a4']) {
    if (!ctx.segredo.ehAmeaca(a)) await ctx.service.confirmarPosicao(a, 'p1');
  }
  for (const [a, jogada] of Object.entries(jogadas)) {
    await ctx.service.acaoAmeaca(a, 'p1', jogada);
  }
}

describe('Isolateus — o brilho misterioso (Task 15)', () => {
  it('o ciclo é de 3 noites', () => {
    expect(ISOLATEUS.CICLO_BRILHO).toBe(3);
  });

  it('Ameaça que só aguardou: o setor dela brilha', async () => {
    const ctx = vila();
    await fecharNoite(ctx, { a1: { tipo: 'AGUARDAR' } });
    expect(ctx.partida.brilho).toEqual({
      rodada: NOITE_3,
      setorIds: ['energia'],
    });
    const evento = ctx.partida.acontecimentos.find((e) => e.tipo === 'BRILHO');
    expect(evento?.texto).toBe(
      'Brilho misterioso irradiando no Setor de Energia.',
    );
  });

  it('Ameaça que não jogou (a noite fechou pelo relógio): brilha', async () => {
    const ctx = vila();
    await fecharNoite(ctx, {});
    await ctx.service.pularFase('prof', 'p1');
    expect(ctx.partida.brilho?.setorIds).toEqual(['energia']);
  });

  it('sabotar evita o brilho', async () => {
    const ctx = vila();
    await fecharNoite(ctx, { a1: { tipo: 'SABOTAR' } });
    // A noite de brilho é anunciada mesmo sem brilho: a turma esperava por ela.
    expect(ctx.partida.brilho).toEqual({ rodada: NOITE_3, setorIds: [] });
    const eventos = ctx.partida.acontecimentos.filter((e) => e.tipo === 'BRILHO');
    expect(eventos.map((e) => e.texto)).toEqual([
      'Brilho misterioso não apareceu esta noite.',
    ]);
  });

  it('abdução às cegas num setor vazio também evita (foi uma tentativa)', async () => {
    const ctx = vila();
    await fecharNoite(ctx, {
      a1: { tipo: 'ABDUZIR', setorId: 'abastecimento' },
    });
    expect(ctx.partida.brilho?.setorIds).toEqual([]);
  });

  it('sob Controle Mental, brilha o setor do controlado', async () => {
    const ctx = vila();
    ctx.segredo.controles = [
      { ameacaAlunoId: 'a1', habitanteId: 'h3', rodada: NOITE_3 },
    ];
    await fecharNoite(ctx, { a1: { tipo: 'AGUARDAR' } });
    expect(ctx.partida.brilho?.setorIds).toEqual(['comercio']);
  });

  it('duas Ameaças no mesmo setor geram um brilho só', async () => {
    const ctx = vila({
      ameacas: ['a1', 'a2'],
      posicoes: { h1: 'energia', h2: 'energia' },
    });
    await fecharNoite(ctx, {
      a1: { tipo: 'AGUARDAR' },
      a2: { tipo: 'AGUARDAR' },
    });
    expect(ctx.partida.brilho?.setorIds).toEqual(['energia']);
    expect(
      ctx.partida.acontecimentos.filter((e) => e.tipo === 'BRILHO'),
    ).toHaveLength(1);
  });

  it('cada Ameaça tem o próprio brilho', async () => {
    const ctx = vila({
      ameacas: ['a1', 'a2'],
      posicoes: { h1: 'energia', h2: 'saude' },
    });
    await fecharNoite(ctx, {
      a1: { tipo: 'AGUARDAR' },
      a2: { tipo: 'SABOTAR' },
    });
    expect(ctx.partida.brilho?.setorIds).toEqual(['energia']);
  });

  it('fora do ciclo, nada brilha', async () => {
    const ctx = vila();
    ctx.partida.rodada = 1; // Noite 2
    await fecharNoite(ctx, { a1: { tipo: 'AGUARDAR' } });
    expect(ctx.partida.brilho ?? null).toBeNull();
    expect(ctx.partida.acontecimentos.some((e) => e.tipo === 'BRILHO')).toBe(false);
  });
});

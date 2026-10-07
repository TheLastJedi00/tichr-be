import { ForbiddenException } from '@nestjs/common';
import { vilaComAmeacas } from './isolateus-vila.fixture-spec';

/**
 * Spec 025 §2: quem convoca a Quarentena é público, a apuração conta só os
 * votos reais e quem prendeu um inocente fica uma rodada sem convocar.
 *
 * Vila: a1/h1 é a Ameaça; h2..h5 são aldeões reais; todos na Comunicação.
 */
function vila(opts: { npcs?: number } = {}) {
  const posicoes: Record<string, string> = {};
  for (let i = 1; i <= 5; i++) posicoes[`h${i}`] = 'comunicacao';
  for (let i = 1; i <= (opts.npcs ?? 0); i++) posicoes[`n${i}`] = 'comunicacao';
  const v = vilaComAmeacas({
    status: 'RESULTADO_RODADA',
    ameacas: ['a1'],
    npcs: opts.npcs ?? 0,
    posicoes,
  });
  v.partida.rodada = 1;
  return v;
}

/** Abre a votação e faz os reais votarem (alunoId → habitante suspeito). */
async function votar(
  v: ReturnType<typeof vila>,
  votos: Record<string, string>,
  convocador = 'a2',
) {
  await v.service.convocarQuarentena('p1', convocador);
  await v.service.pularFase('prof', 'p1'); // debate → votação
  for (const [alunoId, suspeito] of Object.entries(votos)) {
    await v.service.votarSuspeito(alunoId, 'p1', suspeito);
  }
  if (v.partida.status === 'QUARENTENA_VOTO') {
    await v.service.pularFase('prof', 'p1'); // encerra a votação
  }
}

describe('Isolateus — bloqueio de quem prendeu um inocente (Task 12)', () => {
  it('prendeu inocente: o convocador fica bloqueado na rodada seguinte', async () => {
    const v = vila();
    await votar(v, { a2: 'h5', a3: 'h5', a4: 'h5' }, 'a3');
    expect(v.partida.convocadorBloqueado).toEqual({
      habitanteId: 'h3',
      ateRodada: 2,
    });

    v.partida.rodada = 2;
    v.partida.status = 'RESULTADO_RODADA';
    const erro = await v.service
      .convocarQuarentena('p1', 'a3')
      .catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ForbiddenException);
    expect((erro as ForbiddenException).getResponse()).toMatchObject({
      code: 'CONVOCADOR_BLOQUEADO',
    });
  });

  it('o bloqueio é só dele: outro habitante convoca normalmente', async () => {
    const v = vila();
    await votar(v, { a2: 'h5', a3: 'h5', a4: 'h5' }, 'a3');
    v.partida.rodada = 2;
    v.partida.status = 'RESULTADO_RODADA';
    await v.service.convocarQuarentena('p1', 'a2');
    expect(v.partida.status).toBe('QUARENTENA_DEBATE');
  });

  it('o bloqueio dura uma rodada só', async () => {
    const v = vila();
    await votar(v, { a2: 'h5', a3: 'h5', a4: 'h5' }, 'a3');
    v.partida.rodada = 3;
    v.partida.status = 'RESULTADO_RODADA';
    await v.service.convocarQuarentena('p1', 'a3');
    expect(v.partida.status).toBe('QUARENTENA_DEBATE');
  });

  it('prender uma Ameaça não bloqueia ninguém', async () => {
    const v = vilaComAmeacas({
      status: 'RESULTADO_RODADA',
      ameacas: ['a1', 'a2'], // sobra outra: a partida segue
      posicoes: Object.fromEntries(
        [1, 2, 3, 4, 5].map((i) => [`h${i}`, 'comunicacao']),
      ),
    });
    v.partida.rodada = 1;
    await v.service.convocarQuarentena('p1', 'a3');
    await v.service.pularFase('prof', 'p1');
    for (const a of ['a3', 'a4', 'a5']) {
      await v.service.votarSuspeito(a, 'p1', 'h1');
    }
    await v.service.pularFase('prof', 'p1');
    expect(v.partida.habitantes.find((h) => h.id === 'h1')!.preso).toBe(true);
    expect(v.partida.convocadorBloqueado ?? null).toBeNull();
  });
});

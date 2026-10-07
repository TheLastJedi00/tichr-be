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

describe('Isolateus — o convocador é público (Task 10)', () => {
  it('grava quem convocou e registra no Diário', async () => {
    const v = vila();
    await v.service.convocarQuarentena('p1', 'a3');
    expect(v.partida.quarentenaConvocadaPor).toEqual({
      habitanteId: 'h3',
      nome: 'Real 3',
    });
    const evento = v.partida.acontecimentos.at(-1)!;
    expect(evento.tipo).toBe('QUARENTENA');
    expect(evento.texto).toBe('Real 3 convocou a Quarentena.');
  });

  it('o convocador sai do doc quando a Quarentena termina', async () => {
    const v = vila();
    await votar(v, { a2: 'h4', a3: 'h4', a4: 'h4', a5: 'h4', a1: 'h4' });
    expect(v.partida.quarentenaConvocadaPor).toBeNull();
  });
});

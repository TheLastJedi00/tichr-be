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

describe('Isolateus — a apuração conta só os votos reais (Task 11)', () => {
  it('com NPCs na vila, o preso é o mais votado pelos reais', async () => {
    // 20 NPCs: com o voto aleatório deles, o resultado viraria sorteio.
    for (let rep = 0; rep < 10; rep++) {
      const v = vila({ npcs: 20 });
      await votar(v, { a2: 'h4', a3: 'h4', a5: 'h3' });
      expect(v.partida.habitantes.find((h) => h.id === 'h4')!.preso).toBe(true);
    }
  });

  it('empate entre os reais: o preso é um dos empatados', async () => {
    const presos = new Set<string>();
    for (let rep = 0; rep < 30; rep++) {
      const v = vila({ npcs: 5 });
      await votar(v, { a2: 'h4', a3: 'h4', a4: 'h5', a5: 'h5' });
      const preso = v.partida.habitantes.find((h) => h.preso)!;
      expect(['h4', 'h5']).toContain(preso.id);
      presos.add(preso.id);
    }
    // Sorteio, não "o primeiro da lista": os dois aparecem.
    expect(presos.size).toBe(2);
  });

  it('ninguém votou: a Quarentena ainda expulsa alguém vivo na vila', async () => {
    const v = vila({ npcs: 3 });
    const vivosAntes = v.partida.vivos.map((h) => h.id);
    await votar(v, {});
    const presos = v.partida.habitantes.filter((h) => h.preso);
    expect(presos).toHaveLength(1);
    expect(vivosAntes).toContain(presos[0].id);
  });
});

import { HttpException } from '@nestjs/common';
import { ISOLATEUS } from './entities/isolateus-match.entity';
import {
  convocarPelaNoite,
  noiteAberta,
  vilaComAmeacas,
} from './isolateus-vila.fixture-spec';

/**
 * Spec 034 — turnos enxutos: a Quarentena é convocada à noite, o Dia de 15s
 * não existe mais, toda rodada tem questão e a partida dura o banco de
 * questões. A correta do fixture é a alternativa 1.
 */
const CERTA = 1;

const codigo = (e: unknown) =>
  ((e as HttpException).getResponse() as { code?: string }).code;

/** Vila toda na Comunicação (é de lá que se convoca). Ameaça: a1. */
function vila(
  opts: { reais?: number; npcs?: number; ameacas?: string[] } = {},
) {
  const reais = opts.reais ?? 5;
  const posicoes: Record<string, string> = {};
  for (let i = 1; i <= reais; i++) posicoes[`h${i}`] = 'comunicacao';
  const v = vilaComAmeacas({
    status: 'DESLOCAMENTO',
    reais,
    npcs: opts.npcs ?? 0,
    ameacas: opts.ameacas ?? ['a1'],
    posicoes,
  });
  noiteAberta(v);
  return v;
}

type Vila = ReturnType<typeof vila>;

/** Todos os reais respondem; a questão fecha sozinha no último. */
async function responderTodos(v: Vila, alt = CERTA) {
  for (const h of v.partida.habitantes) {
    if (v.partida.status !== 'QUESTAO_ATIVA') break; // fechou no avanço rápido
    const aluno = v.segredo.alunoDe(h.id);
    if (aluno) await v.service.responder(aluno, 'p1', alt);
  }
  if (v.partida.status === 'QUESTAO_ATIVA') {
    await v.service.pularFase('prof', 'p1');
  }
}

/** A noite fecha (pulo do professor) e a questão abre. */
async function amanhecer(v: Vila) {
  await v.service.pularFase('prof', 'p1');
}

describe('Isolateus 034 — a Quarentena é convocada à noite', () => {
  it('fora da noite: 400 FORA_DA_NOITE', async () => {
    const v = vila();
    v.partida.status = 'QUESTAO_ATIVA';
    const erro = await v.service.convocarQuarentena('p1', 'a2').catch((e) => e);
    expect(codigo(erro)).toBe('FORA_DA_NOITE');
  });

  it('antes de a noite começar (card de resultado): 400 NOITE_NAO_COMECOU', async () => {
    const v = vila();
    v.partida.faseIniciadaEm = new Date(Date.now() + 5_000).toISOString();
    const erro = await v.service.convocarQuarentena('p1', 'a2').catch((e) => e);
    expect(codigo(erro)).toBe('NOITE_NAO_COMECOU');
  });

  it('o segundo convocador recebe 409 QUARENTENA_JA_CONVOCADA', async () => {
    const v = vila();
    await v.service.convocarQuarentena('p1', 'a2');
    const erro = await v.service.convocarQuarentena('p1', 'a3').catch((e) => e);
    expect((erro as HttpException).getStatus()).toBe(409);
    expect(codigo(erro)).toBe('QUARENTENA_JA_CONVOCADA');
  });

  it('a convocação fica no cofre e NÃO fecha a jogada da noite', async () => {
    const v = vila();
    await v.service.convocarQuarentena('p1', 'a2');
    expect(v.segredo.quarentenaConvocadaNoite).toEqual({ habitanteId: 'h2' });
    expect(v.segredo.confirmacoesNoite ?? []).toEqual([]);
    expect(v.partida.movimentosRecebidos).toBe(0);
    // Nada público até o amanhecer.
    expect(v.partida.quarentenaConvocadaPor).toBeNull();
  });

  it('o amanhecer confirma: o convocador fica público e entra no Diário', async () => {
    const v = vila();
    await v.service.convocarQuarentena('p1', 'a2');
    await amanhecer(v);
    expect(v.partida.quarentenaConvocadaPor).toEqual({
      habitanteId: 'h2',
      nome: 'Real 2',
    });
    expect(v.partida.acontecimentos.map((e) => e.texto)).toContain(
      'Real 2 convocou a Quarentena.',
    );
    expect(v.segredo.quarentenaConvocadaNoite).toBeNull();
  });

  it('Comunicação sabotada na mesma noite cancela a convocação', async () => {
    const v = vila();
    await v.service.acaoAmeaca('a1', 'p1', { tipo: 'SABOTAR' }); // h1 na Comunicação
    await v.service.convocarQuarentena('p1', 'a2');
    await amanhecer(v);

    expect(
      v.partida.setores.find((s) => s.id === 'comunicacao')!.intacto,
    ).toBe(false);
    expect(v.partida.quarentenaConvocadaPor).toBeNull();
    expect(v.partida.acontecimentos.map((e) => e.texto)).toContain(
      'O rádio caiu antes de a convocação sair.',
    );
    // A rodada segue sem Quarentena: a questão e depois a noite.
    await responderTodos(v);
    expect(v.partida.status).toBe('DESLOCAMENTO');
  });

  it('ordem: questão → Quarentena → card → noite seguinte (sem o Dia)', async () => {
    const v = vila();
    await convocarPelaNoite(v, 'a2'); // chega na reunião
    expect(v.partida.status).toBe('QUARENTENA_DEBATE');

    await v.service.pularFase('prof', 'p1'); // debate → votação
    for (const a of ['a1', 'a2', 'a3', 'a4', 'a5']) {
      await v.service.votarSuspeito(a, 'p1', 'h4');
    }
    expect(v.partida.status).toBe('DESLOCAMENTO');
    expect(v.partida.rodada).toBe(1);
    // A noite espera o card de resultado (#55).
    expect(Date.parse(v.partida.faseIniciadaEm!)).toBeGreaterThan(Date.now());
    expect(v.partida.vereditoQuarentena).not.toBeNull();
  });

  it('rodada sem Quarentena nem resgate: do amanhecer à noite, com o card', async () => {
    const v = vila();
    await amanhecer(v);
    expect(v.partida.status).toBe('QUESTAO_ATIVA');
    await responderTodos(v);
    expect(v.partida.status).toBe('DESLOCAMENTO');
    expect(v.partida.resumoRodada).not.toBeNull();
    const espera = Date.parse(v.partida.faseIniciadaEm!) - Date.now();
    expect(espera).toBeGreaterThan(ISOLATEUS.JANELA_RESULTADO_MS - 1500);
    expect(espera).toBeLessThanOrEqual(ISOLATEUS.JANELA_RESULTADO_MS);
  });

  it('partida antiga parada em RESULTADO_RODADA ainda avança', async () => {
    const v = vila();
    v.partida.status = 'RESULTADO_RODADA';
    await v.service.pularFase('prof', 'p1');
    expect(v.partida.status).toBe('DESLOCAMENTO');
    expect(v.partida.rodada).toBe(1);
  });
});

describe('Isolateus 034 — a noite espera o card (#55)', () => {
  it.each([
    ['mover', (v: Vila) => v.service.mover('a2', 'p1', 'energia')],
    ['ficar', (v: Vila) => v.service.confirmarPosicao('a2', 'p1')],
    ['reparo', (v: Vila) => v.service.declararReparo('a2', 'p1')],
    [
      'jogada da Ameaça',
      (v: Vila) => v.service.acaoAmeaca('a1', 'p1', { tipo: 'AGUARDAR' }),
    ],
  ])('%s antes do faseIniciadaEm: 400 NOITE_NAO_COMECOU', async (_n, acao) => {
    const v = vila();
    v.partida.faseIniciadaEm = new Date(Date.now() + 4_000).toISOString();
    const erro = await acao(v).catch((e: unknown) => e);
    expect(codigo(erro)).toBe('NOITE_NAO_COMECOU');
  });

  it('a primeira noite não tem card nem espera', async () => {
    // O Despertar grava `faseIniciadaEm` = agora: a noite já conta.
    const v = vila();
    await expect(v.service.confirmarPosicao('a2', 'p1')).resolves.toBeDefined();
  });
});

describe('Isolateus 034 — toda rodada tem questão (#48)', () => {
  it('noite calma abre a questão com alerta neutro; sem disputa só vale os pontos', async () => {
    const v = vila();
    v.partida.esperanca = 70;
    await amanhecer(v);
    expect(v.partida.status).toBe('QUESTAO_ATIVA');
    expect(v.partida.alerta).toMatchObject({ tipo: 'NEUTRA' });

    await responderTodos(v);
    // Esperança e setores não mudam por uma questão sem disputa.
    expect(v.partida.esperanca).toBe(70);
    expect(v.partida.setoresIntactos).toBe(6);
    // Os pontos de quem acertou foram creditados.
    expect(v.segredo.pontos.a2).toBeGreaterThan(0);
    expect(v.partida.questaoIndex).toBe(1);
  });

  it('N questões = N rodadas: encerra depois da última', async () => {
    const v = vila();
    v.partida.totalRodadas = 3;
    for (let i = 0; i < 3; i++) {
      expect(v.partida.status).toBe('DESLOCAMENTO');
      expect(v.partida.rodada).toBe(i);
      expect(v.partida.questaoIndex).toBe(i);
      noiteAberta(v);
      await amanhecer(v);
      await responderTodos(v);
    }
    expect(v.partida.status).toBe('ENCERRADO');
    expect(v.partida.questaoIndex).toBe(3);
    expect(v.partida.rodada).toBe(2);
    expect(v.partida.veredito?.lado).toBe('VILA'); // resistência
  });

  it('o professor ainda encerra antes da última', async () => {
    const v = vila();
    await v.service.encerrarPeloProfessor('prof', 'p1');
    expect(v.partida.status).toBe('ENCERRADO');
  });

  it('a última questão espera o resgate e a Quarentena dela antes de encerrar', async () => {
    const v = vila({ reais: 6 });
    v.partida.totalRodadas = 1;
    // Dois fora da vila: o resgate pede votação.
    v.partida.habitantes.find((h) => h.id === 'h5')!.vivo = false;
    v.partida.habitantes.find((h) => h.id === 'h6')!.vivo = false;
    v.partida.resgatePendente = true;
    await v.service.convocarQuarentena('p1', 'a2');
    await amanhecer(v);
    await responderTodos(v);
    expect(v.partida.status).toBe('RESGATE_VOTO'); // 1º: o resgate
    await v.service.pularFase('prof', 'p1');
    expect(v.partida.status).toBe('QUARENTENA_DEBATE'); // 2º: a Quarentena
    await v.service.pularFase('prof', 'p1');
    await v.service.pularFase('prof', 'p1'); // fecha a votação
    expect(v.partida.status).toBe('ENCERRADO'); // só então o veredito
  });
});

describe('Isolateus 034 — Esperança em 0 é colapso, não fim (#50)', () => {
  it('o dano além de 0 é ignorado e a partida segue', async () => {
    const v = vila();
    v.partida.esperanca = 0;
    await v.service.acaoAmeaca('a1', 'p1', { tipo: 'SABOTAR' });
    await amanhecer(v);
    expect(v.partida.esperanca).toBe(0);
    expect(v.partida.status).toBe('QUESTAO_ATIVA');
  });

  it('o reparo tira a vila do colapso', async () => {
    const v = vila();
    v.partida.esperanca = 0;
    v.partida.setores.find((s) => s.id === 'comunicacao')!.intacto = false;
    await v.service.declararReparo('a2', 'p1'); // todos estão na Comunicação
    await amanhecer(v);
    await responderTodos(v, CERTA);
    expect(v.partida.esperanca).toBe(ISOLATEUS.CURA_REPARO);
    expect(v.partida.status).toBe('DESLOCAMENTO');
  });
});

describe('Isolateus 034 — o veredito final (#52)', () => {
  const fim = async (mexer: (v: Vila) => void) => {
    const v = vila();
    v.partida.totalRodadas = 1;
    mexer(v);
    await amanhecer(v);
    await responderTodos(v);
    return v;
  };

  it('Esperança em 0: a Ameaça vence', async () => {
    const v = await fim((x) => (x.partida.esperanca = 0));
    expect(v.partida.veredito?.lado).toBe('AMEACA');
  });

  it('mais de 3 setores destruídos: a Ameaça vence', async () => {
    const v = await fim((x) => {
      for (const s of x.partida.setores.slice(0, 4)) s.intacto = false;
    });
    expect(v.partida.veredito?.lado).toBe('AMEACA');
  });

  it('mais da metade abduzida: a Ameaça vence', async () => {
    const v = await fim((x) => {
      for (const h of x.partida.habitantes.slice(1, 5)) h.vivo = false;
    });
    expect(v.partida.veredito?.lado).toBe('AMEACA');
  });

  it('senão a Vila vence por resistência', async () => {
    const v = await fim(() => undefined);
    expect(v.partida.veredito?.lado).toBe('VILA');
  });
});

describe('Isolateus 034 — recusas com code estável (#64)', () => {
  it('reparo: quem organizou ouve REPARO_JA_ORGANIZADO, os outros REPARO_EM_ANDAMENTO', async () => {
    const v = vila();
    v.partida.setores.find((s) => s.id === 'comunicacao')!.intacto = false;
    await v.service.declararReparo('a2', 'p1');
    const meu = await v.service.declararReparo('a2', 'p1').catch((e) => e);
    const outro = await v.service.declararReparo('a3', 'p1').catch((e) => e);
    expect(codigo(meu)).toBe('REPARO_JA_ORGANIZADO');
    expect(codigo(outro)).toBe('REPARO_EM_ANDAMENTO');
  });

  it('fora da noite: FORA_DA_NOITE em mover, ficar e jogada da Ameaça', async () => {
    const v = vila();
    v.partida.status = 'QUESTAO_ATIVA';
    for (const acao of [
      () => v.service.mover('a2', 'p1', 'energia'),
      () => v.service.confirmarPosicao('a2', 'p1'),
      () => v.service.acaoAmeaca('a1', 'p1', { tipo: 'AGUARDAR' }),
    ]) {
      const erro = await acao().catch((e: unknown) => e);
      expect(codigo(erro)).toBe('FORA_DA_NOITE');
    }
  });

  it('quem saiu da vila: FORA_DA_VILA na noite e FORA_DA_VILA_VOTO na urna', async () => {
    const v = vila();
    v.partida.habitantes.find((h) => h.id === 'h3')!.vivo = false;
    const noite = await v.service.mover('a3', 'p1', 'energia').catch((e) => e);
    expect(codigo(noite)).toBe('FORA_DA_VILA');
    v.partida.status = 'QUARENTENA_VOTO';
    const urna = await v.service.votarSuspeito('a3', 'p1', 'h2').catch((e) => e);
    expect(codigo(urna)).toBe('FORA_DA_VILA_VOTO');
  });
});

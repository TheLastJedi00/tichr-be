import { BadRequestException } from '@nestjs/common';
import { XpService } from '../turma/xp.service';
import {
  Habitante,
  ISOLATEUS,
  IsolateusMatchEntity,
  StatusIsolateus,
} from './entities/isolateus-match.entity';
import { IsolateusSegredoEntity } from './entities/isolateus-segredo.entity';
import { IsolateusGameService } from './isolateus-game.service';
import { IsolateusJogoRepository } from './isolateus-jogo.repository';
import { IsolateusMatchRepository } from './isolateus-match.repository';
import { SETORES } from './isolateus.data';

const QUESTOES = Array.from({ length: 5 }, (_, i) => ({
  enunciado: `Q${i}`,
  alternativas: ['a', 'b', 'c', 'd'],
  corretaIndex: 1,
}));

/**
 * Uma vila com DUAS Ameaças (a original `a1`/`h1` e a contagiada `a2`/`h2`),
 * mais reais `h3..hN` e NPCs `n1..nM`. `posicoes` mapeia habitante → setor
 * (padrão: Segurança).
 */
export function vilaComAmeacas(
  opts: {
    status?: StatusIsolateus;
    reais?: number;
    npcs?: number;
    ameacas?: string[];
    posicoes?: Record<string, string>;
  } = {},
) {
  const nReais = opts.reais ?? 5;
  const nNpcs = opts.npcs ?? 0;
  const pos = opts.posicoes ?? {};
  const habitantes: Habitante[] = [];
  const vinculos: Array<{ habitanteId: string; alunoId?: string }> = [];
  for (let i = 1; i <= nReais; i++) {
    habitantes.push({
      id: `h${i}`,
      nome: `Real ${i}`,
      vivo: true,
      preso: false,
      setorId: pos[`h${i}`] ?? 'seguranca',
    });
    vinculos.push({ habitanteId: `h${i}`, alunoId: `a${i}` });
  }
  for (let i = 1; i <= nNpcs; i++) {
    habitantes.push({
      id: `n${i}`,
      nome: `NPC ${i}`,
      vivo: true,
      preso: false,
      setorId: pos[`n${i}`] ?? 'seguranca',
    });
    vinculos.push({ habitanteId: `n${i}` });
  }

  const status = opts.status ?? 'DESLOCAMENTO';
  const partida = new IsolateusMatchEntity({
    id: 'p1',
    jogoId: 'j1',
    professorId: 'prof',
    turmaId: 't1',
    nome: 'A Vila',
    status,
    criadaEm: new Date().toISOString(),
    esperanca: ISOLATEUS.ESPERANCA_INICIAL,
    setores: SETORES.map((s) => ({ id: s.id, nome: s.nome, intacto: true })),
    habitantes,
    rodada: 0,
    questaoIndex: 0,
    reparoSetorId: null,
    totalRodadas: QUESTOES.length,
    duracaoSegundos: 60,
    faseIniciadaEm: new Date().toISOString(),
    questaoPublica:
      status === 'QUESTAO_ATIVA'
        ? { enunciado: 'Q0', alternativas: ['a', 'b', 'c', 'd'] }
        : null,
    corretaIndex: null,
    alerta: null,
    acontecimentos: [],
    rumores: [],
    debate: [],
    resumoRodada: null,
    quarentenaRodada: null,
    vereditoQuarentena: null,
    votosRecebidos: 0,
    pulosRecebidos: 0,
    movimentosRecebidos: 0,
    inscritos: [],
    veredito: null,
    rankingFinal: [],
  });

  const segredo = new IsolateusSegredoEntity({
    id: 'p1',
    partidaId: 'p1',
    alienAlunoId: 'a1',
    ameacas: opts.ameacas ?? ['a1', 'a2'],
    vinculos,
    acaoRodada: null,
    pulosDebate: [],
    confirmacoesNoite: [],
    pontos: {},
  });

  const respostas: Array<{
    rodada: number;
    alunoId: string;
    alternativaIndex: number;
    correta: boolean;
    pontos: number;
  }> = [];
  const votos: Array<{ rodada: number; alunoId: string; suspeitoId: string }> =
    [];
  const repo = {
    buscar: jest.fn(async () => partida),
    buscarSegredo: jest.fn(async () => segredo),
    commitPartida: jest.fn(async (_id, publico = {}, seg = {}) => {
      Object.assign(partida, publico);
      Object.assign(segredo, seg);
    }),
    registrarResposta: jest.fn(async (_id, rodada: number, r) => {
      if (respostas.some((x) => x.rodada === rodada && x.alunoId === r.alunoId)) {
        return false;
      }
      respostas.push({ rodada, ...r });
      return true;
    }),
    lerRespostas: jest.fn(async (_id, rodada: number) =>
      respostas.filter((x) => x.rodada === rodada),
    ),
    registrarVoto: jest.fn(async (_id, rodada: number, alunoId, suspeitoId) => {
      if (votos.some((v) => v.rodada === rodada && v.alunoId === alunoId)) {
        return false;
      }
      votos.push({ rodada, alunoId, suspeitoId });
      return true;
    }),
    lerVotos: jest.fn(async (_id, rodada: number) =>
      votos.filter((v) => v.rodada === rodada),
    ),
  } as unknown as IsolateusMatchRepository;

  const jogos = {
    findById: jest.fn(async () => ({ id: 'j1', questoes: QUESTOES })),
  } as unknown as IsolateusJogoRepository;
  const creditar = jest.fn().mockResolvedValue(undefined);
  const xp = { creditarPartida: creditar } as unknown as XpService;

  const setorDe = (id: string) =>
    partida.habitantes.find((h) => h.id === id)!.setorId;
  return {
    service: new IsolateusGameService(repo, jogos, xp),
    partida,
    segredo,
    setorDe,
  };
}

/** Todos os reais (menos os listados) confirmam a posição da noite. */
async function aldeoesConfirmam(
  service: IsolateusGameService,
  alunos: string[],
) {
  for (const a of alunos) await service.confirmarPosicao(a, 'p1');
}

describe('Isolateus — várias Ameaças: o cofre', () => {
  it('partida antiga, sem a lista, tem só a Ameaça original', () => {
    const antigo = new IsolateusSegredoEntity({
      alienAlunoId: 'a1',
      vinculos: [],
    });
    expect(antigo.ameacasIds()).toEqual(['a1']);
    expect(antigo.ehAmeaca('a1')).toBe(true);
    expect(antigo.ehAmeaca('a2')).toBe(false);
  });

  it('partida antiga com a jogada no campo único é lida como jogada da original', () => {
    const antigo = new IsolateusSegredoEntity({
      alienAlunoId: 'a1',
      vinculos: [],
      acaoRodada: { tipo: 'SABOTAR', setorId: 'energia' },
    });
    expect(antigo.acoesDaNoite()).toEqual([
      { alunoId: 'a1', acao: { tipo: 'SABOTAR', setorId: 'energia' } },
    ]);
  });

  it('o painel da Ameaça contagiada também diz AMEACA', async () => {
    const { service } = vilaComAmeacas();
    expect((await service.painel('a2', 'p1')).papel).toBe('AMEACA');
    expect((await service.painel('a3', 'p1')).papel).toBe('ALDEAO');
  });
});

describe('Isolateus — várias Ameaças: a noite', () => {
  it('cada Ameaça tem a PRÓPRIA jogada, e cada uma joga uma vez', async () => {
    const { service, segredo } = vilaComAmeacas({
      posicoes: { h1: 'energia', h2: 'saude' },
    });
    await service.acaoAmeaca('a1', 'p1', { tipo: 'SABOTAR' });
    await service.acaoAmeaca('a2', 'p1', { tipo: 'SABOTAR' });
    expect(segredo.acoesDaNoite()).toEqual([
      { alunoId: 'a1', acao: { tipo: 'SABOTAR', setorId: 'energia' } },
      { alunoId: 'a2', acao: { tipo: 'SABOTAR', setorId: 'saude' } },
    ]);
    await expect(
      service.acaoAmeaca('a2', 'p1', { tipo: 'AGUARDAR' }),
    ).rejects.toMatchObject({ response: { code: 'JOGADA_FEITA' } });
  });

  it('a noite só fecha cedo quando TODAS as Ameaças jogaram', async () => {
    const { service, partida } = vilaComAmeacas({ reais: 5 });
    await aldeoesConfirmam(service, ['a3', 'a4', 'a5']);
    await service.acaoAmeaca('a1', 'p1', { tipo: 'AGUARDAR' });
    await service.confirmarPosicao('a2', 'p1');
    expect(partida.status).toBe('DESLOCAMENTO'); // falta a jogada da a2

    await service.acaoAmeaca('a2', 'p1', { tipo: 'AGUARDAR' });
    expect(partida.status).toBe('RESULTADO_RODADA');
  });

  it('a carência vale enquanto faltar a jogada de QUALQUER Ameaça', async () => {
    const { service, partida } = vilaComAmeacas({ reais: 5 });
    const inicio = partida.faseIniciadaEm;
    await service.acaoAmeaca('a1', 'p1', { tipo: 'AGUARDAR' });
    await aldeoesConfirmam(service, ['a2', 'a3', 'a4', 'a5']);
    // Todos se posicionaram; a a2 ainda não jogou: o relógio encurta.
    expect(partida.faseIniciadaEm).not.toBe(inicio);
    expect(partida.status).toBe('DESLOCAMENTO');
  });

  it('duas sabotagens derrubam os dois setores', async () => {
    const { service, partida } = vilaComAmeacas({
      reais: 5,
      posicoes: { h1: 'energia', h2: 'saude' },
    });
    await aldeoesConfirmam(service, ['a3', 'a4', 'a5']);
    await service.acaoAmeaca('a1', 'p1', { tipo: 'SABOTAR' });
    await service.acaoAmeaca('a2', 'p1', { tipo: 'SABOTAR' });

    const ruinas = partida.setores.filter((s) => !s.intacto).map((s) => s.id);
    expect(ruinas.sort()).toEqual(['energia', 'saude']);
    expect(partida.esperanca).toBe(100 - 2 * ISOLATEUS.DANO_SABOTAGEM);
    expect(
      partida.acontecimentos.filter((a) => a.tipo === 'SABOTAGEM'),
    ).toHaveLength(2);
  });

  it('uma Ameaça não abduz a aliada', async () => {
    const { service } = vilaComAmeacas({
      posicoes: { h1: 'energia', h2: 'energia' },
    });
    await expect(
      service.acaoAmeaca('a1', 'p1', { tipo: 'ABDUZIR', alvoId: 'h2' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('Isolateus — várias Ameaças: a questão', () => {
  it('duas abduções, UMA questão: errar entrega as duas vítimas', async () => {
    const { service, partida, segredo } = vilaComAmeacas({
      status: 'QUESTAO_ATIVA',
      reais: 6,
    });
    segredo.acoesRodada = [
      { alunoId: 'a1', acao: { tipo: 'ABDUZIR', alvoId: 'h3' } },
      { alunoId: 'a2', acao: { tipo: 'ABDUZIR', alvoId: 'h4' } },
    ];
    for (const a of ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']) {
      await service.responder(a, 'p1', 3); // todos erram
    }
    expect(partida.habitantes.find((h) => h.id === 'h3')!.vivo).toBe(false);
    expect(partida.habitantes.find((h) => h.id === 'h4')!.vivo).toBe(false);
    expect(partida.esperanca).toBe(100 - 2 * ISOLATEUS.DANO_ABDUCAO);
    expect(partida.questaoIndex).toBe(1); // uma questão só
    // As duas Ameaças pontuam pelo erro da vila.
    expect(segredo.pontos['a1']).toBe(ISOLATEUS.PONTOS_ACERTO);
    expect(segredo.pontos['a2']).toBe(ISOLATEUS.PONTOS_ACERTO);
  });

  it('duas abduções: acertar repele as duas, com UM card de repelida', async () => {
    const { service, partida, segredo } = vilaComAmeacas({
      status: 'QUESTAO_ATIVA',
      reais: 6,
    });
    segredo.acoesRodada = [
      { alunoId: 'a1', acao: { tipo: 'ABDUZIR', alvoId: 'h3' } },
      { alunoId: 'a2', acao: { tipo: 'ABDUZIR', alvoId: 'h4' } },
    ];
    for (const a of ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']) {
      await service.responder(a, 'p1', 1);
    }
    expect(partida.habitantes.every((h) => h.vivo)).toBe(true);
    expect(
      partida.acontecimentos.filter((a) => a.tipo === 'REPELIDA'),
    ).toHaveLength(1);
  });

  it('abdução às cegas nunca sorteia uma Ameaça', async () => {
    const { service, partida, segredo } = vilaComAmeacas({
      status: 'QUESTAO_ATIVA',
      reais: 4,
      posicoes: { h2: 'abastecimento' }, // só a aliada está lá
    });
    segredo.acoesRodada = [
      { alunoId: 'a1', acao: { tipo: 'ABDUZIR', setorId: 'abastecimento' } },
    ];
    for (const a of ['a1', 'a2', 'a3', 'a4']) {
      await service.responder(a, 'p1', 3);
    }
    expect(partida.habitantes.find((h) => h.id === 'h2')!.vivo).toBe(true);
    expect(partida.resumoRodada?.texto).toContain('repelida');
  });
});

describe('Isolateus — várias Ameaças: a Quarentena', () => {
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

  it('prender uma Ameaça restando outra: a partida segue, sem dizer quantas restam', async () => {
    const ctx = vilaComAmeacas({ reais: 5 });
    await prender(ctx, 'h2', ['a1', 'a2', 'a3', 'a4', 'a5']);

    expect(ctx.partida.vereditoQuarentena?.eraAmeaca).toBe(true);
    expect(ctx.partida.status).toBe('RESULTADO_RODADA');
    expect(ctx.partida.faseIniciadaEm).not.toBeNull(); // a noite cai sozinha
    expect(ctx.partida.esperanca).toBe(100); // acertar não custa Esperança
    const texto = ctx.partida.vereditoQuarentena!.texto;
    expect(texto).toContain('AMEAÇA');
    expect(texto).toContain('não acabou');
    // Nada de "resta 1" (o codinome sai da conta: o de teste tem dígito).
    expect(texto.replace('Real 2', '')).not.toMatch(/\d/);
  });

  it('prender a última Ameaça livre dá a vitória à vila', async () => {
    const ctx = vilaComAmeacas({ reais: 5 });
    ctx.partida.habitantes.find((h) => h.id === 'h2')!.preso = true;
    await prender(ctx, 'h1', ['a1', 'a3', 'a4', 'a5']);

    expect(ctx.partida.status).toBe('ENCERRADO');
    expect(ctx.partida.veredito?.lado).toBe('VILA');
  });

  it('vitória da Ameaça credita o bônus a TODAS as Ameaças', async () => {
    const ctx = vilaComAmeacas({ reais: 5 });
    ctx.partida.esperanca = ISOLATEUS.DANO_INOCENTE;
    await prender(ctx, 'h3', ['a1', 'a2', 'a3', 'a4', 'a5']); // inocente

    expect(ctx.partida.veredito?.lado).toBe('AMEACA');
    const pts = (a: string) =>
      ctx.partida.rankingFinal.find((p) => p.alunoId === a)!.pontos;
    expect(pts('a1')).toBe(ISOLATEUS.BONUS_VITORIA);
    expect(pts('a2')).toBe(ISOLATEUS.BONUS_VITORIA);
    expect(pts('a3')).toBe(0);
  });
});

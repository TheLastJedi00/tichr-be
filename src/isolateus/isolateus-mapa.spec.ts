import { ForbiddenException } from '@nestjs/common';
import { XpService } from '../turma/xp.service';
import {
  Habitante,
  ISOLATEUS,
  IsolateusMatchEntity,
} from './entities/isolateus-match.entity';
import { IsolateusSegredoEntity } from './entities/isolateus-segredo.entity';
import { IsolateusGameService } from './isolateus-game.service';
import { IsolateusJogoRepository } from './isolateus-jogo.repository';
import { IsolateusMatchRepository } from './isolateus-match.repository';
import { SETORES } from './isolateus.data';

const QUESTOES = Array.from({ length: 3 }, (_, i) => ({
  enunciado: `Q${i}`,
  alternativas: ['a', 'b', 'c', 'd'],
  corretaIndex: 1,
}));

/**
 * Uma vila espalhada pelo mapa. `posicoes` mapeia habitante → setor; o `h1`
 * (aluno `a1`) é sempre a Ameaça.
 */
function mapa(opts: {
  reais?: number;
  posicoes?: Record<string, string>;
  status?: IsolateusMatchEntity['status'];
  ruinas?: string[];
} = {}) {
  const nReais = opts.reais ?? 4;
  const pos = opts.posicoes ?? {};
  const ruinas = new Set(opts.ruinas ?? []);

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

  const partida = new IsolateusMatchEntity({
    id: 'p1',
    jogoId: 'j1',
    professorId: 'prof',
    turmaId: 't1',
    nome: 'A Vila',
    status: opts.status ?? 'DESLOCAMENTO',
    criadaEm: new Date().toISOString(),
    esperanca: ISOLATEUS.ESPERANCA_INICIAL,
    setores: SETORES.map((s) => ({
      id: s.id,
      nome: s.nome,
      intacto: !ruinas.has(s.id),
    })),
    habitantes,
    rodada: 0,
    questaoIndex: 0,
    reparoSetorId: null,
    totalRodadas: QUESTOES.length,
    duracaoSegundos: 60,
    faseIniciadaEm: new Date().toISOString(),
    questaoPublica: null,
    corretaIndex: null,
    alerta: null,
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
    vinculos,
    acaoRodada: null,
    pulosDebate: [],
    confirmacoesNoite: [],
    pontos: {},
  });

  const repo = {
    buscar: jest.fn(async () => partida),
    buscarSegredo: jest.fn(async () => segredo),
    commitPartida: jest.fn(async (_id, publico = {}, seg = {}) => {
      Object.assign(partida, publico);
      Object.assign(segredo, seg);
    }),
    lerRespostas: jest.fn(async () => []),
    lerVotos: jest.fn(async () => []),
  } as unknown as IsolateusMatchRepository;

  const jogos = {
    findById: jest.fn(async () => ({ id: 'j1', questoes: QUESTOES })),
  } as unknown as IsolateusJogoRepository;
  const xp = {
    creditarPartida: jest.fn().mockResolvedValue(undefined),
  } as unknown as XpService;

  return {
    service: new IsolateusGameService(repo, jogos, xp),
    partida,
    segredo,
  };
}

describe('Isolateus — a Ameaça age onde está', () => {
  it('sabota o setor onde está, ignorando o alvo mandado pelo cliente', async () => {
    // O alvoId do cliente é lixo de propósito: confiar nele deixaria a Ameaça
    // derrubar qualquer setor do mapa de dentro do DevTools.
    const { service, segredo } = mapa({ posicoes: { h1: 'energia' } });
    await service.acaoAmeaca('a1', 'p1', {
      tipo: 'SABOTAR',
      alvoId: 'abastecimento',
    });
    expect(segredo.acaoRodada).toEqual({ tipo: 'SABOTAR', setorId: 'energia' });
  });

  it('não sabota o setor onde está se ele já caiu', async () => {
    const { service } = mapa({
      posicoes: { h1: 'energia' },
      ruinas: ['energia'],
    });
    await expect(
      service.acaoAmeaca('a1', 'p1', { tipo: 'SABOTAR' }),
    ).rejects.toMatchObject({ response: { code: 'SETOR_EM_RUINAS' } });
  });

  it('abdução presencial só alcança quem está no mesmo setor', async () => {
    const { service } = mapa({
      posicoes: { h1: 'energia', h2: 'saude' },
    });
    await expect(
      service.acaoAmeaca('a1', 'p1', { tipo: 'ABDUZIR', alvoId: 'h2' }),
    ).rejects.toMatchObject({ response: { code: 'FORA_DE_ALCANCE' } });
  });

  it('abdução presencial aceita alvo do próprio setor', async () => {
    const { service, segredo } = mapa({
      posicoes: { h1: 'energia', h2: 'energia' },
    });
    await service.acaoAmeaca('a1', 'p1', { tipo: 'ABDUZIR', alvoId: 'h2' });
    expect(segredo.acaoRodada).toEqual({ tipo: 'ABDUZIR', alvoId: 'h2' });
  });

  it('abdução às cegas aposta num setor distante, sem alvo nomeado', async () => {
    const { service, segredo } = mapa({ posicoes: { h1: 'energia' } });
    await service.acaoAmeaca('a1', 'p1', {
      tipo: 'ABDUZIR',
      setorId: 'abastecimento',
    });
    // Nenhum alvo gravado: a vítima só é sorteada na resolução.
    expect(segredo.acaoRodada).toEqual({
      tipo: 'ABDUZIR',
      setorId: 'abastecimento',
    });
  });

  it('não se aposta às cegas no setor que se enxerga', async () => {
    const { service } = mapa({ posicoes: { h1: 'energia' } });
    await expect(
      service.acaoAmeaca('a1', 'p1', { tipo: 'ABDUZIR', setorId: 'energia' }),
    ).rejects.toMatchObject({ response: { code: 'SETOR_VISIVEL' } });
  });

  it('AGUARDAR é uma jogada válida: a Ameaça pode se apagar do mapa', async () => {
    const { service, segredo } = mapa();
    await service.acaoAmeaca('a1', 'p1', { tipo: 'AGUARDAR' });
    expect(segredo.acaoRodada).toEqual({ tipo: 'AGUARDAR' });
  });
});

describe('Isolateus — a Reconstrução', () => {
  it('só quem está DENTRO da ruína organiza o reparo', async () => {
    const { service, partida } = mapa({
      posicoes: { h2: 'energia' },
      ruinas: ['energia'],
    });
    await service.declararReparo('a2', 'p1');
    expect(partida.reparoSetorId).toBe('energia');
  });

  it('não se repara um setor de pé', async () => {
    const { service } = mapa({ posicoes: { h2: 'energia' } });
    await expect(service.declararReparo('a2', 'p1')).rejects.toMatchObject({
      response: { code: 'SETOR_INTACTO' },
    });
  });

  it('um reparo por noite — o segundo é recusado', async () => {
    const { service } = mapa({
      posicoes: { h2: 'energia', h3: 'comercio' },
      ruinas: ['energia', 'comercio'],
    });
    await service.declararReparo('a2', 'p1');
    await expect(service.declararReparo('a3', 'p1')).rejects.toMatchObject({
      response: { code: 'REPARO_EM_ANDAMENTO' },
    });
  });

  it('a declaração é anônima: o público guarda o setor, nunca o autor', async () => {
    // Autor visível seria atestado de que aquele habitante é real — NPC nenhum
    // organiza reparo, e a Névoa de Guerra encolheria sozinha a cada noite.
    const { service, partida } = mapa({
      posicoes: { h2: 'energia' },
      ruinas: ['energia'],
    });
    await service.declararReparo('a2', 'p1');

    // O público guarda o setor e mais nada: nenhum campo liga o reparo a um
    // habitante, e o alunoId nem aparece.
    expect(partida.reparoSetorId).toBe('energia');
    expect(JSON.stringify(partida)).not.toContain('a2');
    const campos = JSON.stringify(partida).match(/"[a-zA-Z]+":/g) ?? [];
    expect(campos).not.toContain('"reparoAutor":');
    expect(campos).not.toContain('"reparoHabitanteId":');
  });
});

describe('Isolateus — a Quarentena sai da Comunicação', () => {
  it('quem está fora da Comunicação não convoca', async () => {
    const { service } = mapa({
      posicoes: { h2: 'energia' },
      status: 'RESULTADO_RODADA',
    });
    await expect(
      service.convocarQuarentena('p1', 'a2'),
    ).rejects.toMatchObject({ response: { code: 'FORA_DA_COMUNICACAO' } });
  });

  it('quem está na Comunicação convoca', async () => {
    const { service, partida } = mapa({
      posicoes: { h2: 'comunicacao' },
      status: 'RESULTADO_RODADA',
    });
    await service.convocarQuarentena('p1', 'a2');
    expect(partida.status).toBe('QUARENTENA_DEBATE');
  });

  it('Comunicação em ruínas cala a vila — até ela reconstruir o rádio', async () => {
    const { service, partida } = mapa({
      posicoes: { h2: 'comunicacao' },
      status: 'RESULTADO_RODADA',
      ruinas: ['comunicacao'],
    });
    await expect(
      service.convocarQuarentena('p1', 'a2'),
    ).rejects.toMatchObject({ response: { code: 'COMUNICACAO_EM_RUINAS' } });

    // Reconstruído, o rádio volta a funcionar.
    partida.setores.find((s) => s.id === 'comunicacao')!.intacto = true;
    await service.convocarQuarentena('p1', 'a2');
    expect(partida.status).toBe('QUARENTENA_DEBATE');
  });

  it('o professor não convoca: a Quarentena é da vila', async () => {
    // A "válvula pedagógica" do telão saiu. Ela furava a regra que faz da
    // Comunicação o alvo mais valioso do mapa — o professor podia convocar de
    // qualquer lugar, inclusive com o rádio em ruínas. O ritmo da aula ele
    // continua governando por "Adiantar noite".
    const { service } = mapa({
      posicoes: { h2: 'energia' },
      status: 'RESULTADO_RODADA',
      ruinas: ['comunicacao'],
    });
    await expect(
      service.convocarQuarentena('p1', 'prof'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('quem saiu da vila não convoca, nem estando na Comunicação', async () => {
    const { service, partida } = mapa({
      posicoes: { h2: 'comunicacao' },
      status: 'RESULTADO_RODADA',
    });
    partida.habitantes.find((h) => h.id === 'h2')!.vivo = false;
    await expect(
      service.convocarQuarentena('p1', 'a2'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

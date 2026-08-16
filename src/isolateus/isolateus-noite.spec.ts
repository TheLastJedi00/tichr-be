import { BadRequestException, ForbiddenException } from '@nestjs/common';
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
import { SETORES, vizinhosDe } from './isolateus.data';

const QUESTOES = Array.from({ length: 3 }, (_, i) => ({
  enunciado: `Q${i}`,
  alternativas: ['a', 'b', 'c', 'd'],
  corretaIndex: 1,
}));

/**
 * Uma vila em plena noite (`DESLOCAMENTO`), com posições controladas.
 *
 * `posicoes` mapeia habitante → setor. Os reais são `h1..hN` (o `h1` é sempre a
 * Ameaça, aluno `a1`); os NPCs são `n1..nM`.
 */
function noite(opts: {
  reais?: number;
  npcs?: number;
  posicoes?: Record<string, string>;
} = {}) {
  const nReais = opts.reais ?? 4;
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

  const partida = new IsolateusMatchEntity({
    id: 'p1',
    jogoId: 'j1',
    professorId: 'prof',
    turmaId: 't1',
    nome: 'A Vila',
    status: 'DESLOCAMENTO',
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
    setorDe: (id: string) => partida.habitantes.find((h) => h.id === id)!.setorId,
  };
}

describe('Isolateus — a noite: deslocamento pelo mapa', () => {
  it('anda um setor pela estrada', async () => {
    const { service, setorDe } = noite({ posicoes: { h2: 'comunicacao' } });
    await service.mover('a2', 'p1', 'abastecimento');
    expect(setorDe('h2')).toBe('abastecimento');
  });

  it('recusa salto para setor sem estrada direta', async () => {
    const { service, setorDe } = noite({ posicoes: { h2: 'abastecimento' } });
    // Abastecimento é beco sem saída: só liga a Comunicação.
    await expect(
      service.mover('a2', 'p1', 'seguranca'),
    ).rejects.toMatchObject({ response: { code: 'SEM_ESTRADA' } });
    expect(setorDe('h2')).toBe('abastecimento');
  });

  it('mover para o próprio setor é "eu fico", e não erro', async () => {
    const { service, partida, setorDe } = noite({ posicoes: { h2: 'energia' } });
    await service.mover('a2', 'p1', 'energia');
    expect(setorDe('h2')).toBe('energia');
    expect(partida.movimentosRecebidos).toBe(1);
  });

  it('confirmar duas vezes não conta dobrado', async () => {
    const { service, partida } = noite();
    await service.confirmarPosicao('a2', 'p1');
    await service.confirmarPosicao('a2', 'p1');
    expect(partida.movimentosRecebidos).toBe(1);
  });

  it('quem saiu da vila não se desloca', async () => {
    const { service, partida } = noite();
    partida.habitantes.find((h) => h.id === 'h2')!.vivo = false;
    await expect(service.mover('a2', 'p1', 'energia')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('fora da janela da noite, ninguém se desloca', async () => {
    const { service, partida } = noite();
    partida.status = 'QUESTAO_ATIVA';
    await expect(service.mover('a2', 'p1', 'energia')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('a contagem publicada não diz QUEM confirmou', async () => {
    // A lista seria uma lista de habitantes reais — entregaria a Névoa de Guerra.
    const { service, partida, segredo } = noite();
    await service.confirmarPosicao('a2', 'p1');
    await service.confirmarPosicao('a3', 'p1');

    expect(partida.movimentosRecebidos).toBe(2);
    expect(JSON.stringify(partida)).not.toContain('a2');
    expect(segredo.confirmacoesNoite).toEqual(['a2', 'a3']);
  });
});

describe('Isolateus — o amanhecer', () => {
  /** Todos confirmam menos a Ameaça, que age por último. */
  async function todosConfirmam(
    service: IsolateusGameService,
    reais: number,
  ) {
    for (let i = 2; i <= reais; i++) {
      await service.confirmarPosicao(`a${i}`, 'p1');
    }
  }

  it('a noite não fecha enquanto a Ameaça não jogar', async () => {
    const { service, partida } = noite({ reais: 4 });
    await todosConfirmam(service, 4);
    await service.confirmarPosicao('a1', 'p1'); // a Ameaça só se posiciona

    // Fechar aqui transformaria a pressa da vila em anulação do turno dela.
    expect(partida.status).toBe('DESLOCAMENTO');
  });

  it('sabotagem fecha a noite SEM questão: ela não é contestada', async () => {
    const { service, partida } = noite({ reais: 4 });
    await todosConfirmam(service, 4);
    await service.acaoAmeaca('a1', 'p1', { tipo: 'SABOTAR' });

    // O setor cai na hora; o que a vila pode fazer é marchar até lá e reconstruir.
    expect(partida.status).toBe('RESULTADO_RODADA');
    expect(partida.questaoPublica).toBeNull();
    expect(partida.setores.find((s) => s.id === 'seguranca')!.intacto).toBe(false);
    expect(partida.esperanca).toBe(100 - ISOLATEUS.DANO_SABOTAGEM);
    // Nenhuma questão consumida: o banco só é gasto por disputa.
    expect(partida.questaoIndex).toBe(0);
  });

  it('abdução fecha a noite ABRINDO a questão de defesa', async () => {
    const { service, partida } = noite({ reais: 4 });
    await todosConfirmam(service, 4);
    await service.acaoAmeaca('a1', 'p1', { tipo: 'ABDUZIR', alvoId: 'h2' });

    expect(partida.status).toBe('QUESTAO_ATIVA');
    expect(partida.alerta?.tipo).toBe('ABDUCAO');
    expect(partida.questaoPublica?.enunciado).toBe('Q0');
    // Ninguém foi levado ainda — a turma ainda pode repelir.
    expect(partida.habitantes.find((h) => h.id === 'h2')!.vivo).toBe(true);
  });

  it('a Ameaça não joga duas vezes na mesma noite', async () => {
    const { service } = noite({ reais: 4 });
    await service.acaoAmeaca('a1', 'p1', { tipo: 'SABOTAR' });
    await expect(
      service.acaoAmeaca('a1', 'p1', { tipo: 'ABDUZIR', alvoId: 'h2' }),
    ).rejects.toMatchObject({ response: { code: 'JOGADA_FEITA' } });
  });

  it('o tempo esgotado fecha a noite mesmo sem a Ameaça, com alerta neutro', async () => {
    const { service, partida } = noite({ reais: 4 });
    partida.faseIniciadaEm = new Date(
      Date.now() - ISOLATEUS.LIMITE_DESLOCAMENTO_MS - 1000,
    ).toISOString();

    await service.resolverPorTempo('prof', 'p1');

    // Sem jogada e sem reparo, nao ha o que perguntar: o dia abre direto no card.
    // E o texto e o mesmo de uma noite calma — dizer "a Ameaca nao agiu"
    // denunciaria quem sumiu do jogo.
    expect(partida.status).toBe('RESULTADO_RODADA');
    expect(partida.resumoRodada?.texto).toContain('sem incidentes');
  });

  it('os NPCs também andam — e só no fechamento da noite', async () => {
    // NPC parado seria identificado em uma noite; por eliminação, a vila saberia
    // quem é real. Com 12 NPCs e 45% de chance, ao menos um se move.
    const { service, partida } = noite({ reais: 4, npcs: 12 });
    const antes = new Map(partida.habitantes.map((h) => [h.id, h.setorId]));

    await todosConfirmam(service, 4);
    expect(partida.habitantes.filter((h) => h.setorId !== antes.get(h.id))).toEqual(
      [],
    ); // ninguém se mexeu ainda: os NPCs só andam no fechamento
    await service.acaoAmeaca('a1', 'p1', { tipo: 'SABOTAR' });

    const npcs = partida.habitantes.filter((h) => h.id.startsWith('n'));
    const mexeram = npcs.filter((h) => h.setorId !== antes.get(h.id));
    expect(mexeram.length).toBeGreaterThan(0);
    // E cada um andou por uma estrada de verdade, não teleportou.
    for (const npc of mexeram) {
      expect(vizinhosDe(antes.get(npc.id)!)).toContain(npc.setorId);
    }
  });

  it('a nova noite reabre a janela e zera as confirmações', async () => {
    const { service, partida, segredo } = noite({ reais: 4 });
    await service.acaoAmeaca('a1', 'p1', { tipo: 'SABOTAR' });
    partida.status = 'RESULTADO_RODADA';

    await service.proxima('prof', 'p1');

    expect(partida.status).toBe('DESLOCAMENTO');
    expect(partida.rodada).toBe(1);
    expect(partida.movimentosRecebidos).toBe(0);
    expect(segredo.confirmacoesNoite).toEqual([]);
    expect(segredo.acaoRodada).toBeNull();
    expect(partida.faseIniciadaEm).not.toBeNull();
  });
});

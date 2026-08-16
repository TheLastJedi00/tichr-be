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
import {
  IsolateusMatchRepository,
  RespostaIsolateus,
} from './isolateus-match.repository';
import { SETORES } from './isolateus.data';

const QUESTOES = Array.from({ length: 3 }, (_, i) => ({
  enunciado: `Q${i}`,
  alternativas: ['a', 'b', 'c', 'd'],
  corretaIndex: 1, // a alternativa correta é sempre a 'b'
}));

/**
 * Monta uma vila: `reais` habitantes reais (o 1º é o Alien) + `npcs` virtuais.
 * O repositório é em memória e separa camada pública de cofre, como o real.
 */
function cenario(opts: { reais?: number; npcs?: number; rodada?: number; setor?: string } = {}) {
  const nReais = opts.reais ?? 4;
  const nNpcs = opts.npcs ?? 0;
  // A vila inteira num setor so: mantem todos ao alcance da Ameaca, para que
  // estes testes exercitem o motor e nao a geografia (que tem specs proprias).
  const setor = opts.setor ?? 'seguranca';

  const habitantes: Habitante[] = [];
  const vinculos: Array<{ habitanteId: string; alunoId?: string }> = [];
  for (let i = 1; i <= nReais; i++) {
    habitantes.push({ id: `h${i}`, nome: `Real ${i}`, vivo: true, preso: false, setorId: setor });
    vinculos.push({ habitanteId: `h${i}`, alunoId: `a${i}` });
  }
  for (let i = 1; i <= nNpcs; i++) {
    habitantes.push({ id: `n${i}`, nome: `NPC ${i}`, vivo: true, preso: false, setorId: setor });
    vinculos.push({ habitanteId: `n${i}` });
  }

  const partida = new IsolateusMatchEntity({
    id: 'p1',
    jogoId: 'j1',
    professorId: 'prof',
    turmaId: 't1',
    nome: 'A Vila',
    status: 'QUESTAO_ATIVA',
    criadaEm: new Date().toISOString(),
    esperanca: ISOLATEUS.ESPERANCA_INICIAL,
    setores: SETORES.map((s) => ({ ...s, intacto: true })),
    habitantes,
    rodada: opts.rodada ?? 0,
    questaoIndex: 0,
    reparoSetorId: null,
    totalRodadas: QUESTOES.length,
    duracaoSegundos: 60,
    faseIniciadaEm: new Date().toISOString(),
    questaoPublica: { enunciado: 'Q0', alternativas: ['a', 'b', 'c', 'd'] },
    corretaIndex: null,
    alerta: null,
    rumores: [],
    debate: [],
    resumoRodada: null,
    quarentenaRodada: null,
    vereditoQuarentena: null,
    votosRecebidos: 0,
    pulosRecebidos: 0,
    inscritos: [],
    veredito: null,
    rankingFinal: [],
  });

  const segredo = new IsolateusSegredoEntity({
    id: 'p1',
    partidaId: 'p1',
    alienAlunoId: 'a1', // o primeiro real é sempre a Ameaça nos testes
    vinculos,
    acaoRodada: { tipo: 'ABDUZIR', alvoId: 'h3' },
    pontos: {},
  });

  const respostas: RespostaIsolateus[] = [];
  const repo = {
    buscar: jest.fn(async () => partida),
    buscarSegredo: jest.fn(async () => segredo),
    commitPartida: jest.fn(async (_id, publico = {}, seg = {}) => {
      Object.assign(partida, publico);
      Object.assign(segredo, seg);
    }),
    registrarResposta: jest.fn(async (_id, _rodada, r: RespostaIsolateus) => {
      if (respostas.some((x) => x.alunoId === r.alunoId)) return false;
      respostas.push(r);
      return true;
    }),
    lerRespostas: jest.fn(async () => respostas),
  } as unknown as IsolateusMatchRepository;

  const jogos = {
    findById: jest.fn(async () => ({ id: 'j1', questoes: QUESTOES })),
  } as unknown as IsolateusJogoRepository;

  const creditar = jest.fn().mockResolvedValue(undefined);
  const xp = { creditarPartida: creditar } as unknown as XpService;

  return {
    service: new IsolateusGameService(repo, jogos, xp),
    partida,
    segredo,
    creditar,
  };
}

/** Todos os reais respondem `index` (a menos que `exceto` diga outra coisa). */
async function todosRespondem(
  service: IsolateusGameService,
  reais: number,
  index: number,
  exceto: Record<string, number> = {},
) {
  for (let i = 1; i <= reais; i++) {
    const alunoId = `a${i}`;
    await service.responder(alunoId, 'p1', exceto[alunoId] ?? index);
  }
}

describe('Isolateus — o Ciclo de Invasão', () => {
  it('a turma acerta: a abdução é repelida e ninguém é levado', async () => {
    const { service, partida } = cenario({ reais: 4 });
    await todosRespondem(service, 4, 1); // 'b' = correta

    expect(partida.status).toBe('RESULTADO_RODADA');
    expect(partida.resumoRodada?.defendida).toBe(true);
    expect(partida.resumoRodada?.texto).toContain('repelida');
    expect(partida.habitantes.find((h) => h.id === 'h3')!.vivo).toBe(true);
    expect(partida.esperanca).toBe(100);
    expect(partida.corretaIndex).toBe(1); // a correta só aparece agora
  });

  it('a turma erra: a vítima é levada e a Esperança decai 10', async () => {
    const { service, partida, segredo } = cenario({ reais: 4 });
    await todosRespondem(service, 4, 3); // todos na alternativa errada

    expect(partida.resumoRodada?.defendida).toBe(false);
    expect(partida.habitantes.find((h) => h.id === 'h3')!.vivo).toBe(false);
    expect(partida.resumoRodada?.texto).toContain('foi abduzido');
    expect(partida.esperanca).toBe(100 - ISOLATEUS.DANO_ABDUCAO);
    // A Ameaça pontua pelo erro da turma — nunca pela sabotagem, que é automática.
    expect(segredo.pontos['a1']).toBe(ISOLATEUS.PONTOS_ACERTO);
  });

  it('abdução às cegas em setor vazio dá o MESMO texto de repelida', async () => {
    // Se o texto fosse outro, a vila saberia que a Ameaça atirou de longe e
    // errou — e, por eliminação, onde ela NÃO está.

    // (a) defesa bem-sucedida: a turma acerta e a abdução é repelida.
    const repelida = cenario({ reais: 4 });
    await todosRespondem(repelida.service, 4, 1);

    // (b) tiro às cegas num setor sem ninguém, com a turma errando.
    const errou = cenario({ reais: 4 });
    errou.partida.habitantes.forEach((h) => (h.setorId = 'seguranca'));
    errou.segredo.acaoRodada = { tipo: 'ABDUZIR', setorId: 'abastecimento' };
    await todosRespondem(errou.service, 4, 3);

    expect(errou.partida.resumoRodada!.texto).toBe(
      repelida.partida.resumoRodada!.texto,
    );
    // Ninguém foi levado nos dois casos — e a Esperança não caiu.
    expect(errou.partida.habitantes.every((h) => h.vivo)).toBe(true);
    expect(errou.partida.esperanca).toBe(100);
  });

  it('abdução às cegas sorteia a vítima entre quem está no setor apostado', async () => {
    const { service, partida, segredo } = cenario({ reais: 4 });
    partida.habitantes.forEach((h) => (h.setorId = 'seguranca'));
    partida.habitantes.find((h) => h.id === 'h4')!.setorId = 'abastecimento';
    segredo.acaoRodada = { tipo: 'ABDUZIR', setorId: 'abastecimento' };

    await todosRespondem(service, 4, 3); // a turma erra

    // Só havia um habitante lá: é ele quem some.
    expect(partida.habitantes.find((h) => h.id === 'h4')!.vivo).toBe(false);
    expect(partida.resumoRodada?.texto).toContain('Abastecimento');
  });

  it('a reconstrução: acertar reergue o setor e devolve a Esperança', async () => {
    const { service, partida, segredo } = cenario({ reais: 4 });
    segredo.acaoRodada = null; // noite só de reparo
    partida.setores.find((s) => s.id === 'energia')!.intacto = false;
    partida.esperanca = 100 - ISOLATEUS.DANO_SABOTAGEM;
    partida.reparoSetorId = 'energia';

    await todosRespondem(service, 4, 1);

    expect(partida.setores.find((s) => s.id === 'energia')!.intacto).toBe(true);
    expect(partida.esperanca).toBe(100); // devolve exatamente o que a sabotagem tirou
    expect(partida.resumoRodada?.texto).toContain('reconstruído');
    expect(partida.reparoSetorId).toBeNull();
  });

  it('a reconstrução: errar deixa o setor em ruínas e pontua a Ameaça', async () => {
    const { service, partida, segredo } = cenario({ reais: 4 });
    segredo.acaoRodada = null;
    partida.setores.find((s) => s.id === 'energia')!.intacto = false;
    partida.esperanca = 85;
    partida.reparoSetorId = 'energia';

    await todosRespondem(service, 4, 3);

    expect(partida.setores.find((s) => s.id === 'energia')!.intacto).toBe(false);
    expect(partida.esperanca).toBe(85); // fracassar nao custa Esperanca extra
    expect(partida.resumoRodada?.texto).toContain('fracassou');
    expect(segredo.pontos['a1']).toBe(ISOLATEUS.PONTOS_ACERTO);
  });

  it('abdução e reparo na mesma noite: UMA questão resolve os dois', async () => {
    const { service, partida } = cenario({ reais: 4 });
    partida.setores.find((s) => s.id === 'energia')!.intacto = false;
    partida.esperanca = 100 - ISOLATEUS.DANO_SABOTAGEM;
    partida.reparoSetorId = 'energia';

    await todosRespondem(service, 4, 1);

    // Um acerto so: a vitima e salva E o setor volta de pe.
    expect(partida.habitantes.find((h) => h.id === 'h3')!.vivo).toBe(true);
    expect(partida.setores.find((s) => s.id === 'energia')!.intacto).toBe(true);
    expect(partida.esperanca).toBe(100);
    // E uma so questao foi consumida.
    expect(partida.questaoIndex).toBe(1);
  });

  it('a Esperança restaurada nunca passa de 100', async () => {
    const { service, partida, segredo } = cenario({ reais: 4 });
    segredo.acaoRodada = null;
    partida.setores.find((s) => s.id === 'energia')!.intacto = false;
    partida.esperanca = 95;
    partida.reparoSetorId = 'energia';

    await todosRespondem(service, 4, 1);
    expect(partida.esperanca).toBe(ISOLATEUS.ESPERANCA_INICIAL);
  });

  it('quem acerta pontua com bônus de rapidez; quem erra não pontua', async () => {
    const { service, segredo } = cenario({ reais: 4 });
    await todosRespondem(service, 4, 1, { a4: 0 });

    expect(segredo.pontos['a2']).toBeGreaterThanOrEqual(ISOLATEUS.PONTOS_ACERTO);
    expect(segredo.pontos['a2']).toBeLessThanOrEqual(
      ISOLATEUS.PONTOS_ACERTO + ISOLATEUS.BONUS_RAPIDEZ,
    );
    expect(segredo.pontos['a4']).toBeUndefined();
  });

  it('Instinto Humano: empate entre reais resolve pela alternativa de menor índice', async () => {
    // 2 reais na correta ('b' = 1) e 2 na errada ('d' = 3), sem NPCs: empate
    // perfeito. O desempate olha só para os reais (também empatados) e cai na de
    // menor índice — determinístico, sem depender do acaso.
    const { service, partida } = cenario({ reais: 4, npcs: 0 });
    await todosRespondem(service, 4, 1, { a3: 3, a4: 3 });

    expect(partida.status).toBe('RESULTADO_RODADA');
    expect(partida.resumoRodada?.defendida).toBe(true); // venceu a 'b'
    expect(partida.esperanca).toBe(100);
  });

  it('o abduzido continua respondendo e pontuando, mas não trava nem vota a rodada', async () => {
    const { service, partida, segredo } = cenario({ reais: 4 });
    partida.habitantes.find((h) => h.id === 'h4')!.vivo = false; // a4 foi levado

    // Só os 3 que restaram na vila votam — e isso já resolve a rodada, mesmo
    // com o abduzido ainda sem responder.
    await service.responder('a1', 'p1', 1);
    await service.responder('a2', 'p1', 1);
    await service.responder('a3', 'p1', 1);
    expect(partida.status).toBe('RESULTADO_RODADA');
    expect(segredo.pontos['a4']).toBeUndefined();

    // E ele segue pontuando na tela hackeada, fora da vila (§7).
    partida.status = 'QUESTAO_ATIVA';
    await service.responder('a4', 'p1', 1);
    expect(segredo.pontos['a4']).toBeGreaterThanOrEqual(
      ISOLATEUS.PONTOS_ACERTO,
    );
  });

  it('o rumor forjado sai no nome de um NPC, e só a Ameaça pode forjá-lo', async () => {
    const { service, partida } = cenario({ reais: 4, npcs: 3 });

    await expect(
      service.forjarRumor('a2', 'p1', 'confiem em mim'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await service.forjarRumor('a1', 'p1', 'A resposta certa é a letra D!');
    const forjado = partida.rumores.find((r) => r.tipo === 'FORJADO')!;
    expect(forjado.autorNome).toMatch(/^NPC [123]$/);
    expect(forjado.texto).toBe('A resposta certa é a letra D!');

    // Uma interceptação por rodada.
    await expect(
      service.forjarRumor('a1', 'p1', 'de novo'),
    ).rejects.toMatchObject({ response: { code: 'RUMOR_JA_ENVIADO' } });
  });

  it('sem NPCs, o rumor forjado sai anônimo — o motor não incrimina um real', async () => {
    const { service, partida } = cenario({ reais: 10, npcs: 0 });
    await service.forjarRumor('a1', 'p1', 'é a letra A');
    const forjado = partida.rumores.find((r) => r.tipo === 'FORJADO')!;
    expect(forjado.autorNome).toBe('Voz na Névoa');
  });

  it('o Sinal de Rádio é anônimo e só quem saiu da vila pode enviá-lo', async () => {
    const { service, partida } = cenario({ reais: 4 });

    await expect(service.sinalDeRadio('a2', 'p1', 'é a B')).rejects.toThrow(
      'Você ainda está na vila.',
    );

    partida.habitantes.find((h) => h.id === 'h4')!.vivo = false;
    await service.sinalDeRadio('a4', 'p1', 'não caiam no rumor, é a B');
    const sinal = partida.rumores.find((r) => r.tipo === 'SINAL')!;
    expect(sinal.autorNome).toBe('Sinal Interceptado');
    expect(sinal.autorNome).not.toContain('Real 4');
  });
});

describe('Isolateus — o Veredito por esgotamento (§8)', () => {
  /** Leva a partida até o fim das questões, com o estado final desejado. */
  async function encerrarPorEsgotamento(
    ajustar: (p: IsolateusMatchEntity) => void,
  ) {
    const c = cenario({ reais: 4 });
    c.partida.status = 'RESULTADO_RODADA';
    // O fim por esgotamento agora olha o BANCO DE QUESTOES, nao a contagem de
    // noites: as questoes so sao consumidas quando ha disputa.
    c.partida.questaoIndex = QUESTOES.length;
    ajustar(c.partida);
    await c.service.proxima('prof', 'p1');
    return c;
  }

  it('a Ameaça vence se abduziu mais da metade da população', async () => {
    const { partida } = await encerrarPorEsgotamento((p) => {
      p.habitantes[0].vivo = false;
      p.habitantes[1].vivo = false;
      p.habitantes[2].vivo = false; // 3 de 4
    });
    expect(partida.veredito?.lado).toBe('AMEACA');
    expect(partida.veredito?.motivo).toContain('mais da metade da população');
  });

  it('a Ameaça vence se destruiu mais de 3 setores', async () => {
    const { partida } = await encerrarPorEsgotamento((p) => {
      p.setores[0].intacto = false;
      p.setores[1].intacto = false;
      p.setores[2].intacto = false;
      p.setores[3].intacto = false; // 4 danificados
    });
    expect(partida.veredito?.lado).toBe('AMEACA');
    expect(partida.veredito?.motivo).toContain('3 setores vitais');
  });

  it('a Ameaça é avaliada primeiro quando os dois critérios batem', async () => {
    // Metade+1 da vila abduzida (Ameaça) E 4 setores intactos (Vila).
    const { partida } = await encerrarPorEsgotamento((p) => {
      p.habitantes[0].vivo = false;
      p.habitantes[1].vivo = false;
      p.habitantes[2].vivo = false;
      p.setores[0].intacto = false;
      p.setores[1].intacto = false; // 4 intactos
    });
    expect(partida.setoresIntactos).toBe(4);
    expect(partida.veredito?.lado).toBe('AMEACA');
  });

  it('a Vila vence mantendo mais de 3 setores intactos', async () => {
    const { partida } = await encerrarPorEsgotamento((p) => {
      p.setores[0].intacto = false;
      p.setores[1].intacto = false; // 4 intactos, ninguém abduzido
    });
    expect(partida.veredito?.lado).toBe('VILA');
    expect(partida.veredito?.motivo).toContain('3 setores intactos');
  });

  it('Esperança zerada encerra na hora com vitória da Ameaça', async () => {
    const { service, partida } = cenario({ reais: 4 });
    partida.esperanca = ISOLATEUS.DANO_ABDUCAO; // uma abducao basta para zerar
    await todosRespondem(service, 4, 3); // a turma erra e a vitima e levada

    expect(partida.esperanca).toBe(0);
    expect(partida.status).toBe('ENCERRADO');
    expect(partida.veredito?.lado).toBe('AMEACA');
    expect(partida.veredito?.motivo).toContain('Barra de Esperança');
  });

  it('no encerramento o placar é publicado e o XP creditado com motivo ISOLATEUS', async () => {
    const { service, partida, segredo, creditar } = cenario({ reais: 4 });
    partida.status = 'RESULTADO_RODADA';
    partida.questaoIndex = QUESTOES.length; // banco esgotado
    segredo.pontos = { a2: 1000 };
    await service.proxima('prof', 'p1'); // esgota → Vila vence (tudo intacto)

    expect(partida.veredito?.lado).toBe('VILA');
    // Aldeões vencedores levam o bônus; o Alien (a1) não.
    const a2 = partida.rankingFinal.find((p) => p.alunoId === 'a2')!;
    const a1 = partida.rankingFinal.find((p) => p.alunoId === 'a1')!;
    expect(a2.pontos).toBe(1000 + ISOLATEUS.BONUS_VITORIA);
    expect(a1.pontos).toBe(0);
    expect(a2.posicao).toBe(1);

    expect(creditar).toHaveBeenCalledWith(
      't1',
      expect.arrayContaining([{ alunoId: 'a2', pontos: 2000 }]),
      'ISOLATEUS',
    );
  });

  it('o placar só existe no fim — durante o jogo ele não denuncia quem é real', async () => {
    const { service, partida } = cenario({ reais: 4, npcs: 3 });
    await todosRespondem(service, 4, 1);

    expect(partida.status).toBe('RESULTADO_RODADA');
    expect(partida.rankingFinal).toEqual([]);
    expect(JSON.stringify(partida)).not.toContain('pontos');
  });
});

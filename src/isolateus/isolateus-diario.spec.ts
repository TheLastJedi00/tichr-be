import { XpService } from '../turma/xp.service';
import {
  Habitante,
  ISOLATEUS,
  IsolateusMatchEntity,
  TipoAcontecimento,
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
  corretaIndex: 1,
}));

function cenario(opts: {
  status?: IsolateusMatchEntity['status'];
  posicoes?: Record<string, string>;
  ruinas?: string[];
} = {}) {
  const pos = opts.posicoes ?? {};
  const ruinas = new Set(opts.ruinas ?? []);

  const habitantes: Habitante[] = [];
  const vinculos: Array<{ habitanteId: string; alunoId?: string }> = [];
  for (let i = 1; i <= 4; i++) {
    habitantes.push({
      id: `h${i}`,
      nome: `Real ${i}`,
      vivo: true,
      preso: false,
      setorId: pos[`h${i}`] ?? 'comunicacao',
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
    questaoPublica: { enunciado: 'Q0', alternativas: ['a', 'b', 'c', 'd'] },
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
    vinculos,
    acaoRodada: null,
    pulosDebate: [],
    confirmacoesNoite: [],
    pontos: {},
  });

  const respostas: RespostaIsolateus[] = [];

  /**
   * O diário **como o Firestore o veria**: só o que passou por `commitPartida`.
   *
   * O motor empilha eventos mutando `partida.acontecimentos` antes de commitar.
   * Se o `dados` do commit esquecer o campo, a entidade em memória fica certa e
   * o banco fica sem o evento — foi exatamente o bug que escapou daqui e só
   * apareceu no navegador. Este espelho é o que fecha essa porta.
   */
  let diarioPersistido: IsolateusMatchEntity['acontecimentos'] = [];

  const repo = {
    buscar: jest.fn(async () => partida),
    buscarSegredo: jest.fn(async () => segredo),
    commitPartida: jest.fn(async (_id, publico = {}, seg = {}) => {
      const p = publico as Partial<IsolateusMatchEntity>;
      if (p.acontecimentos) diarioPersistido = p.acontecimentos;
      Object.assign(partida, publico);
      Object.assign(segredo, seg);
    }),
    registrarResposta: jest.fn(async (_id, _r, r: RespostaIsolateus) => {
      if (respostas.some((x) => x.alunoId === r.alunoId)) return false;
      respostas.push(r);
      return true;
    }),
    lerRespostas: jest.fn(async () => respostas),
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
    tipos: () => diarioPersistido.map((a) => a.tipo),
    ultimo: () => diarioPersistido[diarioPersistido.length - 1],
    diario: () => diarioPersistido,
  };
}

/** Todos os reais respondem `index`. */
async function todosRespondem(service: IsolateusGameService, index: number) {
  for (let i = 1; i <= 4; i++) {
    await service.responder(`a${i}`, 'p1', index);
  }
}

describe('Isolateus — o Diário da Vila', () => {
  it('a sabotagem entra no diário e diz qual setor caiu', async () => {
    const c = cenario({ posicoes: { h1: 'energia' } });
    await c.service.acaoAmeaca('a1', 'p1', { tipo: 'SABOTAR' });
    for (let i = 2; i <= 4; i++) await c.service.confirmarPosicao(`a${i}`, 'p1');

    expect(c.tipos()).toContain('SABOTAGEM');
    expect(c.ultimo().texto).toContain('Setor de Energia');
  });

  it('a abdução consumada registra ONDE aconteceu', async () => {
    // É essa informação que dá geografia à dedução da vila.
    const c = cenario({ status: 'QUESTAO_ATIVA', posicoes: { h3: 'saude' } });
    c.segredo.acaoRodada = { tipo: 'ABDUZIR', alvoId: 'h3' };
    await todosRespondem(c.service, 3); // a turma erra

    const abducao = c.diario().find((a) => a.tipo === 'ABDUCAO')!;
    expect(abducao.texto).toContain('Real 3');
    expect(abducao.texto).toContain('Setor de Saúde');
  });

  it('defesa acertada e tiro às cegas no vazio geram o MESMO evento', async () => {
    // Tipo e texto idênticos: qualquer diferença contaria à vila se a Ameaça
    // agiu de perto ou de longe, e por eliminação onde ela não estava.
    const defesa = cenario({ status: 'QUESTAO_ATIVA' });
    defesa.segredo.acaoRodada = { tipo: 'ABDUZIR', alvoId: 'h3' };
    await todosRespondem(defesa.service, 1); // acerta

    const cego = cenario({ status: 'QUESTAO_ATIVA' });
    cego.segredo.acaoRodada = { tipo: 'ABDUZIR', setorId: 'abastecimento' };
    await todosRespondem(cego.service, 3); // erra, mas o setor está vazio

    const a = defesa.diario().find((x) => x.tipo === 'REPELIDA')!;
    const b = cego.diario().find((x) => x.tipo === 'REPELIDA')!;
    expect(b.tipo).toBe(a.tipo);
    expect(b.texto).toBe(a.texto);
  });

  it('o reparo é registrado sem autor', async () => {
    const c = cenario({ posicoes: { h2: 'energia' }, ruinas: ['energia'] });
    await c.service.declararReparo('a2', 'p1');

    const reparo = c.diario().find((a) => a.tipo === 'REPARO')!;
    expect(reparo.texto).toBe('A vila mobilizou um reparo no Setor de Energia.');
    expect(reparo.texto).not.toContain('Real 2');
  });

  it('a reconstrução bem-sucedida e a fracassada têm eventos distintos', async () => {
    const ok = cenario({ status: 'QUESTAO_ATIVA', ruinas: ['energia'] });
    ok.partida.reparoSetorId = 'energia';
    await todosRespondem(ok.service, 1);
    expect(ok.tipos()).toContain('RESTAURADO');

    const falhou = cenario({ status: 'QUESTAO_ATIVA', ruinas: ['energia'] });
    falhou.partida.reparoSetorId = 'energia';
    await todosRespondem(falhou.service, 3);
    expect(falhou.tipos()).toContain('REPARO_FALHOU');
  });

  it('a Quarentena convocada entra no diário', async () => {
    const c = cenario({ status: 'RESULTADO_RODADA' });
    await c.service.convocarQuarentena('p1', 'a2');
    expect(c.tipos()).toContain('QUARENTENA');
  });

  it('a noite que cai é registrada, com o número dela', async () => {
    const c = cenario({ status: 'RESULTADO_RODADA' });
    await c.service.proxima('prof', 'p1');

    const noite = c.diario().find((a) => a.tipo === 'NOITE')!;
    expect(noite.texto).toContain('Noite 2');
    // E fica arquivado sob a noite NOVA, nao sob a que acabou de terminar.
    expect(noite.noite).toBe(1);
  });

  it('o deslocamento NÃO gera evento', async () => {
    // Registrá-lo entregaria o mapa completo de quem foi para onde, anulando a
    // informação parcial em que o jogo inteiro se apoia.
    const c = cenario({ posicoes: { h2: 'comunicacao' } });
    await c.service.mover('a2', 'p1', 'energia');
    await c.service.mover('a3', 'p1', 'saude');
    expect(c.diario()).toEqual([]);
  });

  it('o encerramento registra o motivo técnico da vitória', async () => {
    const c = cenario({ status: 'RESULTADO_RODADA' });
    c.partida.questaoIndex = QUESTOES.length; // banco esgotado
    await c.service.proxima('prof', 'p1');

    const fim = c.diario().find((a) => a.tipo === 'FIM')!;
    expect(fim.texto).toBe(c.partida.veredito!.motivo);
  });

  it('o diário é aparado no teto e mantém as entradas mais recentes', async () => {
    const c = cenario({ status: 'RESULTADO_RODADA' });
    // Enche além do teto pelo caminho normal (convocar/encerrar a Quarentena
    // seria lento; aqui basta empurrar direto na lista publicada).
    c.partida.acontecimentos = Array.from(
      { length: ISOLATEUS.MAX_ACONTECIMENTOS },
      (_, i) => ({
        id: `e${i}`,
        tipo: 'NOITE' as TipoAcontecimento,
        texto: `antigo ${i}`,
        noite: 0,
        em: new Date().toISOString(),
      }),
    );
    await c.service.convocarQuarentena('p1', 'a2');

    expect(c.diario()).toHaveLength(
      ISOLATEUS.MAX_ACONTECIMENTOS,
    );
    expect(c.ultimo().tipo).toBe('QUARENTENA');
    expect(c.diario()[0].texto).toBe('antigo 1'); // o mais velho caiu
  });
});

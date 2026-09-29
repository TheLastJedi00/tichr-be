/**
 * Vila de teste compartilhada pelos specs de várias Ameaças e dos poderes.
 *
 * O nome termina em `-spec.ts` de propósito: fica fora do build (que exclui
 * todo arquivo terminado em `spec.ts`) sem virar suíte do jest (que só roda
 * `.spec.ts`).
 */
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


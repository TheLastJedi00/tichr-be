import { WorGameService } from './wor-game.service';
import { WorJogoRepository } from './wor-jogo.repository';
import {
  EstadoWor,
  MudancasWor,
  WorMatchRepository,
} from './wor-match.repository';
import { WorMatchEntity, WorRodadaPrivada } from './entities/wor-match.entity';
import { WorTeamEntity } from './entities/wor-team.entity';
import { WorJogoEntity } from './entities/wor-jogo.entity';
import { XpService } from '../turma/xp.service';

/**
 * Fake em memória do Wor para os testes (fora do build: `*.fake.ts`). Guarda
 * raiz, equipes e a rodada privada; a `transacao` roda o motor sobre CÓPIAS
 * (como o Firestore, que pode repetir) e só aplica o que ele devolver.
 */
export function fakeWor(
  jogo: WorJogoEntity,
  match: WorMatchEntity,
  teams: WorTeamEntity[],
  opcoes: { xp?: XpService } = {},
) {
  const estado = { rodada: new WorRodadaPrivada() };
  const copia = <T>(x: T): T => structuredClone(x);
  const aplicar = (m: MudancasWor) => {
    if (m.raiz) Object.assign(match, copia(m.raiz));
    for (const [id, d] of Object.entries(m.equipes ?? {})) {
      const t = teams.find((x) => x.id === id);
      if (t) Object.assign(t, copia(d));
    }
    if (m.rodada) estado.rodada = new WorRodadaPrivada(copia(m.rodada));
  };
  const ler = (): EstadoWor => ({
    match: new WorMatchEntity(copia({ ...match })),
    teams: teams.map((t) => new WorTeamEntity(copia({ ...t }))),
    rodada: new WorRodadaPrivada(copia({ ...estado.rodada })),
  });

  const transacoes: MudancasWor[] = [];
  const matches = {
    buscar: async () => new WorMatchEntity(copia({ ...match })),
    listarTeams: async () =>
      teams.map((t) => new WorTeamEntity(copia({ ...t }))),
    atualizar: async (_id: string, d: Partial<WorMatchEntity>) => {
      Object.assign(match, d);
    },
    commitPartida: async (
      _m: string,
      raiz: Partial<WorMatchEntity>,
      equipes: Record<string, Partial<WorTeamEntity>> = {},
    ) => aplicar({ raiz, equipes }),
    buscarRodada: async () => new WorRodadaPrivada(copia({ ...estado.rodada })),
    transacao: async <R>(
      _id: string,
      fn: (e: EstadoWor) => { mudancas: MudancasWor; resultado: R },
    ): Promise<R> => {
      const { mudancas, resultado } = fn(ler());
      transacoes.push(mudancas);
      aplicar(mudancas);
      return resultado;
    },
  } as unknown as WorMatchRepository;

  const creditos: Array<{
    turmaId: string;
    pontos: Array<{ alunoId: string; pontos: number }>;
    motivo?: string;
  }> = [];
  const penalidades: Array<{ turmaId: string; alunoId: string; xp: number }> =
    [];
  const xp = {
    creditarPartida: async (
      turmaId: string,
      pontos: Array<{ alunoId: string; pontos: number }>,
      motivo?: string,
    ) => {
      creditos.push({ turmaId, pontos, motivo });
    },
    penalizarJogo: async (turmaId: string, alunoId: string, qtd: number) => {
      penalidades.push({ turmaId, alunoId, xp: qtd });
    },
  } as unknown as XpService;
  const jogos = { findById: async () => jogo } as unknown as WorJogoRepository;

  return {
    service: new WorGameService(jogos, matches, opcoes.xp ?? xp),
    matches,
    match,
    teams,
    rodada: () => estado.rodada,
    transacoes,
    creditos,
    penalidades,
  };
}

/** Uma equipe com membros `a1`, `a2`… (nome do membro = id em maiúsculas). */
export function equipe(
  id: string,
  membros: string[],
  over: Partial<WorTeamEntity> = {},
): WorTeamEntity {
  return new WorTeamEntity({
    id,
    nome: id,
    membros: membros.map((a) => ({ alunoId: a, nome: a.toUpperCase() })),
    ...over,
  });
}

/** Batalha padrão dos testes: ARTE (3 dicas) e REI (1 dica). */
export const JOGO_TESTE = new WorJogoEntity({
  id: 'j1',
  palavras: [
    { id: 'w1', palavra: 'ARTE', dicas: ['d1', 'd2', 'd3'] },
    { id: 'w2', palavra: 'REI', dicas: ['x1'] },
  ],
});

/** Partida EM_ANDAMENTO na onda 0 (ARTE), rodada aberta agora. */
export function partidaTeste(
  teams: WorTeamEntity[],
  over: Partial<WorMatchEntity> = {},
): WorMatchEntity {
  return new WorMatchEntity({
    id: 'm1',
    jogoId: 'j1',
    professorId: 'p1',
    turmaId: 't1',
    status: 'EM_ANDAMENTO',
    ondaIndex: 0,
    totalOndas: 2,
    mascara: ['_', '_', '_', '_'],
    letrasTentadas: [],
    cartasVisiveis: ['d1'],
    totalCartas: 3,
    ordemEquipes: teams.map((t) => t.id),
    rodadaIniciadaEm: new Date(Date.now()).toISOString(),
    ...over,
  });
}

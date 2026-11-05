import { BadRequestException, ConflictException } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { LogPontuacaoJogador } from './log-pontuacao';
import { valeRanking } from './vale-ranking';

/**
 * Ociosidade nos jogos de rodada (spec 032 §3). Uma FALTA é uma fase com ação
 * esperada que fechou sem ação do aluno. A contagem é total na partida (não
 * precisa ser seguida); a partir do limite o aluno é marcado como ocioso, vê o
 * alerta e, no fim, o professor pode descontar os pontos dele.
 */
export type JogoOcioso = 'QLICK' | 'WOR' | 'ISOLATEUS';

export const OCIOSIDADE = {
  /** Wor e Isolateus: a partir da 2ª falta; Qlick: da 3ª (032 #17). */
  LIMITE_PADRAO: { QLICK: 3, WOR: 2, ISOLATEUS: 2 } as Record<JogoOcioso, number>,
  LIMITE_MIN: 1,
  LIMITE_MAX: 10,
} as const;

export type MapaFaltas = Record<string, number>;

/** O limite da partida (partida antiga, sem o campo, usa o padrão do jogo). */
export function limiteOciosidade(
  partida: { limiteOciosidade?: number | null },
  jogo: JogoOcioso,
): number {
  return partida.limiteOciosidade ?? OCIOSIDADE.LIMITE_PADRAO[jogo];
}

/**
 * Soma uma falta a cada `esperado` que não está em `agiram`. Não muta o mapa
 * recebido (o motor do Wor pode rodar mais de uma vez numa transação).
 */
export function registrarFaltas(
  mapa: MapaFaltas | undefined | null,
  esperados: Iterable<string>,
  agiram: Iterable<string>,
): MapaFaltas {
  const jogou = new Set(agiram);
  const novo: MapaFaltas = { ...(mapa ?? {}) };
  for (const id of new Set(esperados)) {
    if (jogou.has(id)) continue;
    novo[id] = (novo[id] ?? 0) + 1;
  }
  return novo;
}

export function ehOcioso(
  mapa: MapaFaltas | undefined | null,
  id: string,
  limite: number,
): boolean {
  return (mapa?.[id] ?? 0) >= limite;
}

/** Os marcados como ociosos (para o ranking final). */
export function ociosos(
  mapa: MapaFaltas | undefined | null,
  limite: number,
): string[] {
  return Object.keys(mapa ?? {}).filter((id) => ehOcioso(mapa, id, limite));
}

/** Acrescenta faltas e a marca de ocioso a cada linha do log final (032 #19). */
export function marcarNoLog(
  log: LogPontuacaoJogador[],
  faltasDoAluno: (alunoId: string) => number,
  limite: number,
): LogPontuacaoJogador[] {
  return log.map((l) => {
    const faltas = faltasDoAluno(l.alunoId);
    if (!faltas) return l;
    return { ...l, faltasOciosidade: faltas, ocioso: faltas >= limite };
  });
}

// ===== Lobby =====

export class DefinirLimiteOciosidadeDto {
  @Type(() => Number)
  @IsInt()
  @Min(OCIOSIDADE.LIMITE_MIN)
  @Max(OCIOSIDADE.LIMITE_MAX)
  limite: number;
}

export function assertLobbyOciosidade(status: string): void {
  if (status !== 'LOBBY') {
    throw new BadRequestException({
      code: 'PARTIDA_INICIADA',
      message: 'O limite de ociosidade só muda antes de a partida começar.',
    });
  }
}

// ===== Desconto no fim da partida =====

export class DescontarOciosidadeDto {
  @IsString()
  alunoId: string;

  @IsIn(['ZERAR_PARTIDA', 'VALOR'])
  modo: 'ZERAR_PARTIDA' | 'VALOR';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  pontos?: number;
}

/**
 * Valida o desconto e diz quanto debitar (032 #19–#21): só no `ENCERRADO`,
 * nunca em partida casual, só aluno marcado como ocioso, uma vez por aluno.
 * "Zerar" devolve o crédito que a partida deu ao aluno; "valor", o pedido (o
 * `XpService` ainda limita ao XP atual).
 */
export function planejarDesconto(
  partida: {
    status: string;
    turmaId?: string | null;
    valeRanking?: boolean;
    logPontuacao?: LogPontuacaoJogador[];
    descontosOciosidade?: Record<string, number> | null;
  },
  dto: DescontarOciosidadeDto,
): number {
  if (partida.status !== 'ENCERRADO') {
    throw new BadRequestException({
      code: 'PARTIDA_EM_ANDAMENTO',
      message: 'O desconto por ociosidade é feito no fim da partida.',
    });
  }
  if (!valeRanking(partida) || !partida.turmaId) {
    throw new BadRequestException({
      code: 'PARTIDA_CASUAL',
      message: 'Partida casual não mexe no ranking: não há o que descontar.',
    });
  }
  const linha = partida.logPontuacao?.find((l) => l.alunoId === dto.alunoId);
  if (!linha?.ocioso) {
    throw new BadRequestException({
      code: 'NAO_OCIOSO',
      message: 'Esse aluno não foi marcado como ocioso nesta partida.',
    });
  }
  if (partida.descontosOciosidade?.[dto.alunoId] !== undefined) {
    throw new ConflictException({
      code: 'DESCONTO_APLICADO',
      message: 'O desconto desse aluno já foi aplicado.',
    });
  }
  const pontos =
    dto.modo === 'ZERAR_PARTIDA' ? linha.creditoRanking : (dto.pontos ?? 0);
  if (pontos <= 0) {
    throw new BadRequestException({
      code: 'NADA_A_DESCONTAR',
      message:
        dto.modo === 'ZERAR_PARTIDA'
          ? 'O aluno não ganhou pontos nesta partida.'
          : 'Informe quantos pontos descontar.',
    });
  }
  return pontos;
}

/** O log e os descontos depois de aplicar o débito `efetivo` (032 §3.4). */
export function aplicarDescontoNoLog(
  partida: {
    logPontuacao?: LogPontuacaoJogador[];
    descontosOciosidade?: Record<string, number> | null;
  },
  alunoId: string,
  efetivo: number,
): {
  logPontuacao: LogPontuacaoJogador[];
  descontosOciosidade: Record<string, number>;
} {
  const log = (partida.logPontuacao ?? []).map((l) => {
    if (l.alunoId !== alunoId) return l;
    const rodada = l.itens.at(-1)?.rodada ?? 1;
    return {
      ...l,
      creditoRanking: l.creditoRanking - efetivo,
      itens: [
        ...l.itens,
        {
          rodada,
          fonte: 'OCIOSIDADE' as const,
          descricao: `Desconto por ociosidade (${l.faltasOciosidade ?? 0} rodadas sem jogar)`,
          pontos: -efetivo,
        },
      ],
    };
  });
  return {
    logPontuacao: log,
    descontosOciosidade: {
      ...(partida.descontosOciosidade ?? {}),
      [alunoId]: efetivo,
    },
  };
}

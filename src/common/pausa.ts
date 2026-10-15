import { BadRequestException, ConflictException } from '@nestjs/common';

/**
 * A pausa do professor, comum ao Qlick, ao Wor e ao Isolateus (028 §4).
 *
 * Não há timer no servidor: todo relógio é derivado de um marco público
 * (`perguntaIniciadaEm`, `rodadaIniciadaEm`, `faseIniciadaEm`). Pausar só
 * grava `pausadaEm`; retomar empurra esses marcos pelo tempo pausado, e cada
 * fase volta com exatamente o tempo que faltava.
 */

/** Só se pausa a partida em andamento: no lobby não há relógio, e encerrada não há o que pausar. */
export function assertPausavel(status: string): void {
  if (status === 'LOBBY' || status === 'ENCERRADO') {
    throw new BadRequestException({
      code: 'PARTIDA_NAO_PAUSAVEL',
      message: 'Só dá para pausar uma partida em andamento.',
    });
  }
}

/**
 * Pausada, a partida não aceita comando nenhum, de aluno ou de professor,
 * exceto Retomar (028 Decisão #15). Leituras continuam valendo.
 */
export function assertNaoPausada(partida: { pausadaEm?: string | null }): void {
  if (partida.pausadaEm) {
    throw new ConflictException({
      code: 'PARTIDA_PAUSADA',
      message: 'Partida pausada. Aguarde o professor retomar.',
    });
  }
}

/** Quanto tempo a partida ficou pausada até `agora` (ms, nunca negativo). */
export function tempoPausado(pausadaEm: string, agora = Date.now()): number {
  return Math.max(0, agora - Date.parse(pausadaEm));
}

/** Avança um marco de tempo ISO em `ms`; ausente continua ausente. */
export function empurrar<T extends string | null | undefined>(
  iso: T,
  ms: number,
): T {
  if (!iso) return iso;
  return new Date(Date.parse(iso) + ms).toISOString() as T;
}

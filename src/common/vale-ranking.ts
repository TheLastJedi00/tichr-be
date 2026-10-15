import { BadRequestException } from '@nestjs/common';
import { IsBoolean } from 'class-validator';

/**
 * Partida casual (spec 027 §3): desmarcado no lobby, o placar e o log da
 * partida saem normais, mas nada é creditado no ranking da turma.
 */
export class DefinirValeRankingDto {
  @IsBoolean()
  valeRanking: boolean;
}

/** Partida antiga (sem o campo) vale para o ranking, como sempre valeu. */
export function valeRanking(partida: { valeRanking?: boolean }): boolean {
  return partida.valeRanking !== false;
}

/**
 * O checkbox só muda no lobby. Depois do início, o professor poderia ver o
 * placar e decidir se ele conta.
 */
export function assertLobbyValeRanking(status: string): void {
  if (status !== 'LOBBY') {
    throw new BadRequestException({
      code: 'PARTIDA_INICIADA',
      message:
        'Só dá para escolher se a partida vale para o ranking antes de ela começar.',
    });
  }
}

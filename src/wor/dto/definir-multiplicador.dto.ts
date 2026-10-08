import { IsInt, Max, Min } from 'class-validator';
import { WOR } from '../entities/wor-match.entity';

/** O multiplicador de pontos da partida, escolhido no lobby (1x a 10x). */
export class DefinirMultiplicadorDto {
  @IsInt()
  @Min(WOR.MULTIPLICADOR_MIN)
  @Max(WOR.MULTIPLICADOR_MAX)
  multiplicador: number;
}

import { IsInt, Max, Min } from 'class-validator';
import { LIMITE_IA_MAX } from '../config-ia.service';

export class ConfigIaDto {
  /** Máximo de gerações de IA por dia, por jogo, por professor. */
  @IsInt()
  @Min(1)
  @Max(LIMITE_IA_MAX)
  limiteGeracoesDia: number;
}

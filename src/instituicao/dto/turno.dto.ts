import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import type { TipoTurno } from '../entities/instituicao.entity';
import { IntervaloDto } from './intervalo.dto';

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Um turno (matutino/vespertino/noturno) com horarios e recreios proprios. */
export class TurnoDto {
  @IsIn(['MATUTINO', 'VESPERTINO', 'NOTURNO'])
  tipo: TipoTurno;

  @Matches(HORA, { message: 'inicioPrimeiroPeriodo deve estar no formato HH:mm' })
  inicioPrimeiroPeriodo: string;

  @Matches(HORA, { message: 'fimUltimoPeriodo deve estar no formato HH:mm' })
  fimUltimoPeriodo: string;

  @IsInt()
  @Min(5)
  @Max(240)
  duracaoAula: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IntervaloDto)
  intervalos?: IntervaloDto[];
}

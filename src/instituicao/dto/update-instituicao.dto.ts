import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IntervaloDto } from './intervalo.dto';
import { TurnoDto } from './turno.dto';

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

export class UpdateInstituicaoDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  nome?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TurnoDto)
  turnos?: TurnoDto[];

  @IsOptional()
  @IsBoolean()
  aulaUnicaPorTurno?: boolean;

  // ===== Legado — turno unico =====
  @IsOptional()
  @Matches(HORA, { message: 'inicioPrimeiroPeriodo deve estar no formato HH:mm' })
  inicioPrimeiroPeriodo?: string;

  @IsOptional()
  @Matches(HORA, { message: 'fimUltimoPeriodo deve estar no formato HH:mm' })
  fimUltimoPeriodo?: string;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(240)
  duracaoAula?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IntervaloDto)
  intervalos?: IntervaloDto[];

  @IsOptional()
  @Matches(HORA, { message: 'inicioIntervalo deve estar no formato HH:mm' })
  inicioIntervalo?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  duracaoIntervalo?: number;
}

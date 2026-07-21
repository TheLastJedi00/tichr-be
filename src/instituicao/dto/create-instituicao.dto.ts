import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IntervaloDto } from './intervalo.dto';

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateInstituicaoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  nome: string;

  @Matches(HORA, { message: 'inicioPrimeiroPeriodo deve estar no formato HH:mm' })
  inicioPrimeiroPeriodo: string;

  @Matches(HORA, { message: 'fimUltimoPeriodo deve estar no formato HH:mm' })
  fimUltimoPeriodo: string;

  @IsInt()
  @Min(5)
  @Max(240)
  duracaoAula: number;

  /** Intervalos/recreios da grade (formato atual, aceita mais de um). */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IntervaloDto)
  intervalos?: IntervaloDto[];

  // Legado — intervalo unico (ainda aceito para compatibilidade).
  @IsOptional()
  @Matches(HORA, { message: 'inicioIntervalo deve estar no formato HH:mm' })
  inicioIntervalo?: string;

  @ValidateIf((o: CreateInstituicaoDto) => !!o.inicioIntervalo)
  @IsInt()
  @Min(1)
  @Max(120)
  duracaoIntervalo?: number;
}

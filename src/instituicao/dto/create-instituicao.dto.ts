import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

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

  @IsOptional()
  @Matches(HORA, { message: 'inicioIntervalo deve estar no formato HH:mm' })
  inicioIntervalo?: string;

  /** Obrigatorio (e positivo) quando ha inicioIntervalo. */
  @ValidateIf((o: CreateInstituicaoDto) => !!o.inicioIntervalo)
  @IsInt()
  @Min(1)
  @Max(120)
  duracaoIntervalo?: number;
}

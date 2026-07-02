import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
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
import type { TipoModalidade } from '../entities/turma.entity';

export class CreateTurmaDto {
  @IsString()
  @IsNotEmpty()
  nome: string;

  @IsIn(['GRADE_FIXA', 'MODULO_FECHADO'])
  tipoModalidade: TipoModalidade;

  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  diasSemana: number[];

  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'dataInicio deve estar no formato YYYY-MM-DD',
  })
  dataInicio: string;

  /** Obrigatorio quando MODULO_FECHADO. */
  @ValidateIf((o: CreateTurmaDto) => o.tipoModalidade === 'MODULO_FECHADO')
  @IsInt()
  @Min(1)
  totalAulas?: number;

  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'cor deve ser um hex #RRGGBB' })
  cor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  disciplina?: string;

  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/, { message: 'horaInicio deve estar no formato HH:mm' })
  horaInicio?: string;

  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/, { message: 'horaFim deve estar no formato HH:mm' })
  horaFim?: string;
}

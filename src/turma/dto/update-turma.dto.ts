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
  Min,
  ValidateIf,
} from 'class-validator';
import type { TipoModalidade } from '../entities/turma.entity';

export class UpdateTurmaDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  nome?: string;

  @IsOptional()
  @IsIn(['GRADE_FIXA', 'MODULO_FECHADO'])
  tipoModalidade?: TipoModalidade;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  diasSemana?: number[];

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'dataInicio deve estar no formato YYYY-MM-DD',
  })
  dataInicio?: string;

  /** Obrigatorio quando a modalidade enviada e MODULO_FECHADO. */
  @ValidateIf((o: UpdateTurmaDto) => o.tipoModalidade === 'MODULO_FECHADO')
  @IsInt()
  @Min(1)
  totalAulas?: number;
}

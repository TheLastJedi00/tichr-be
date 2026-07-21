import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
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
  ValidateNested,
} from 'class-validator';
import type { NivelEnsino, TipoModalidade } from '../entities/turma.entity';
import { GradeHorariaItemDto } from './grade-horaria-item.dto';

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

  /** Arquiva (ou reativa) a turma para efeito de cota do plano. */
  @IsOptional()
  @IsBoolean()
  encerradaManualmente?: boolean;

  // ===== Configuracao de pontuacao/gamificacao =====

  @IsOptional()
  @IsBoolean()
  pontuacaoAtiva?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  nomePontuacao?: string;

  @IsOptional()
  @IsBoolean()
  rankingAtivo?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  rotuloAdicionar?: string;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  rotuloRemover?: string;

  // Limiares de nivel (XP para alcancar cada tier). Bronze e o piso 0.
  @IsOptional()
  @IsInt()
  @Min(1)
  nivelPrata?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  nivelOuro?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  nivelDiamante?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  nivelPlatina?: number;

  // ===== Ensino regular =====

  @IsOptional()
  @IsString()
  instituicaoId?: string;

  @IsOptional()
  @IsBoolean()
  ensinoRegular?: boolean;

  @IsOptional()
  @IsIn(['FUNDAMENTAL', 'MEDIO'])
  nivelEnsino?: NivelEnsino;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  anoSerie?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GradeHorariaItemDto)
  gradeHoraria?: GradeHorariaItemDto[];
}

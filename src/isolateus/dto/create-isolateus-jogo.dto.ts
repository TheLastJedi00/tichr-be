import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class QuestaoDto {
  @IsString()
  @MaxLength(300)
  enunciado: string;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(6)
  @IsString({ each: true })
  @MaxLength(160, { each: true })
  alternativas: string[];

  /** Índice (0-based) da alternativa correta. */
  @IsInt()
  @Min(0)
  corretaIndex: number;
}

export class CreateIsolateusJogoDto {
  @IsString()
  @MaxLength(120)
  nome: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  disciplina?: string;

  @IsOptional()
  @IsString()
  topicoId?: string;

  /** Aula (1..N) fixada manualmente quando não há tópicos (ENH-001/002). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  numeroAula?: number;

  @IsOptional()
  @IsString()
  turmaId?: string;

  /** Turmas atribuídas à investigação (N:N). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  turmaIds?: string[];

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(600)
  duracaoSegundos?: number;

  /**
   * As questões da investigação. A partida consome uma por rodada — o limite de
   * rodadas é o próprio esgotamento desta lista (§8 da spec: 10 questões).
   */
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => QuestaoDto)
  questoes: QuestaoDto[];
}

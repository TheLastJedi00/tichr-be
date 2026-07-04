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

export class PerguntaDto {
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

export class CreateQlickDto {
  @IsString()
  @MaxLength(120)
  titulo: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  disciplina?: string;

  @IsOptional()
  @IsString()
  topicoId?: string;

  @IsOptional()
  @IsString()
  turmaId?: string;

  /** Turmas atribuídas ao Qlick (N:N). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  turmaIds?: string[];

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(600)
  duracaoSegundos?: number;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PerguntaDto)
  perguntas: PerguntaDto[];
}

import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';

/** Cadastro em lote de tópicos de uma disciplina. */
export class CreateTopicosDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  disciplina: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(120, { each: true })
  nomes: string[];
}

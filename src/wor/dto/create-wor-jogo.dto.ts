import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class PalavraWorDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  palavra: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  dicas?: string[];
}

export class CreateWorJogoDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  nome: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  disciplina?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  topico: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PalavraWorDto)
  palavras: PalavraWorDto[];
}

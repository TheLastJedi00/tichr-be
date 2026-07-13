import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/** Geração do arsenal por IA: instrução do professor + contexto (disciplina/tópico). */
export class GerarArsenalDto {
  @IsString()
  @IsNotEmpty({ message: 'Descreva como você quer as palavras.' })
  @MaxLength(500)
  instrucao: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  disciplina?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  topico?: string;
}

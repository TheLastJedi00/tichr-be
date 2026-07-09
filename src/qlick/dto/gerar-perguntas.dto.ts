import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/** Geração de perguntas por IA: instrução do professor + contexto (disciplina/tópico). */
export class GerarPerguntasDto {
  @IsString()
  @IsNotEmpty({ message: 'Descreva como você quer as perguntas.' })
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

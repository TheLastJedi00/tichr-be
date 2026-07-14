import { IsOptional, IsString, MaxLength } from 'class-validator';

export class GerarQuestoesDto {
  /** O que a investigação deve cobrar (texto livre do professor). */
  @IsString()
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

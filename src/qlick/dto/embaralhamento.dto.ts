import { IsBoolean, IsOptional } from 'class-validator';

/** Lobby: embaralhar perguntas e/ou alternativas por aluno (spec 031). */
export class DefinirEmbaralhamentoDto {
  @IsOptional()
  @IsBoolean()
  embaralharPerguntas?: boolean;

  @IsOptional()
  @IsBoolean()
  embaralharAlternativas?: boolean;
}

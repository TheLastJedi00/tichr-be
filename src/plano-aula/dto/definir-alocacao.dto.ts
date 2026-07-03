import { IsString, ValidateIf } from 'class-validator';

/** Aloca um tópico a uma aula (topicoId) ou desaloca (null). */
export class DefinirAlocacaoDto {
  @ValidateIf((o: DefinirAlocacaoDto) => o.topicoId !== null)
  @IsString()
  topicoId: string | null;
}

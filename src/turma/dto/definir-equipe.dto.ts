import { IsString, ValidateIf } from 'class-validator';

/** Move o aluno para uma equipe (equipeId) ou de volta ao pool (null). */
export class DefinirEquipeDto {
  @ValidateIf((o: DefinirEquipeDto) => o.equipeId !== null)
  @IsString()
  equipeId: string | null;
}

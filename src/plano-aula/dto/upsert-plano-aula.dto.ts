import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Cria/atualiza o escopo geral (Syllabus) de uma disciplina. */
export class UpsertPlanoAulaDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  disciplina: string;

  @IsString()
  @MaxLength(8000)
  contextoGeral: string;
}

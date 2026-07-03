import { ArrayMaxSize, IsArray, IsString } from 'class-validator';

/** Atribuição de um cargo: o conjunto final de alunos responsáveis. */
export class AtribuirCargoDto {
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  alunoIds: string[];
}

import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Renomeia um aluno da lista de chamada. */
export class RenameAlunoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  nome: string;
}

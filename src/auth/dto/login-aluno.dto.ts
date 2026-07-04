import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class LoginAlunoDto {
  @IsString()
  @IsNotEmpty()
  turmaId: string;

  // 2 díg (Smart PIN) ou 4 díg (aluno legado ainda não migrado).
  @Matches(/^\d{2,4}$/, { message: 'pin deve ter de 2 a 4 digitos' })
  pin: string;
}

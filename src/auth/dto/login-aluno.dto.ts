import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class LoginAlunoDto {
  @IsString()
  @IsNotEmpty()
  turmaId: string;

  @Matches(/^\d{4}$/, { message: 'pin deve ter 4 digitos' })
  pin: string;
}

import { IsEmail } from 'class-validator';

export class RecuperarSenhaDto {
  @IsEmail()
  email: string;
}

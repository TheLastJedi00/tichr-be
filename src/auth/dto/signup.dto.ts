import { IsEmail, IsString, MinLength } from 'class-validator';

/** Cadastro frictionless: apenas e-mail e senha (perfil vem depois). */
export class SignupDto {
  @IsEmail({}, { message: 'Informe um e-mail valido.' })
  email: string;

  @IsString()
  @MinLength(6, { message: 'A senha deve ter ao menos 6 caracteres.' })
  password: string;
}

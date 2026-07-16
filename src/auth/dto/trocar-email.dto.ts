import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class TrocarEmailDto {
  @IsEmail()
  novoEmail: string;

  /** Senha atual: reautenticacao exigida por ser operacao sensivel. */
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  senha: string;
}

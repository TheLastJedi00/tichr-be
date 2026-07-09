import { IsNotEmpty, IsString } from 'class-validator';

/** Auto-exclusão da conta: exige a senha atual para reautenticação. */
export class ExcluirContaDto {
  @IsString()
  @IsNotEmpty({ message: 'Informe sua senha para confirmar a exclusao.' })
  senha: string;
}

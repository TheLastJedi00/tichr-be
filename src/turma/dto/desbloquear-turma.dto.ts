import { Matches } from 'class-validator';

/** PIN de 6 dígitos da turma para liberar a lista de nomes no portal. */
export class DesbloquearTurmaDto {
  @Matches(/^\d{6}$/, { message: 'pinTurma deve ter 6 dígitos' })
  pinTurma: string;
}

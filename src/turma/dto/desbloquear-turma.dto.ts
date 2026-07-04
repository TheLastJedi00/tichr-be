import { Matches } from 'class-validator';

/**
 * PIN da turma para liberar a lista de nomes no portal.
 * Aceita 2 díg (Smart PIN) ou 6 díg (turma legada ainda não migrada).
 */
export class DesbloquearTurmaDto {
  @Matches(/^\d{2,6}$/, { message: 'pinTurma deve ter de 2 a 6 dígitos' })
  pinTurma: string;
}

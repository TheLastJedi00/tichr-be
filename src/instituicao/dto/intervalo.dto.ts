import { IsInt, Matches, Max, Min } from 'class-validator';

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Um intervalo/recreio da grade da instituicao. */
export class IntervaloDto {
  @Matches(HORA, { message: 'inicio do intervalo deve estar no formato HH:mm' })
  inicio: string;

  @IsInt()
  @Min(1)
  @Max(120)
  duracao: number;
}

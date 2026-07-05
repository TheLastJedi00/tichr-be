import { IsString, IsNotEmpty } from 'class-validator';

/** Aplicacao de cupom no checkout (professor). */
export class AplicarCupomDto {
  @IsString()
  @IsNotEmpty()
  codigo: string;
}

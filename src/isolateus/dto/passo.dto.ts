import { IsNumber, Max, Min } from 'class-validator';
import { CENA } from '../isolateus-cena';

export class PassoDto {
  /** O destino da caminhada, em px da cena (nunca a posição contínua). */
  @IsNumber()
  @Min(0)
  @Max(CENA.LARGURA)
  alvoX: number;
}

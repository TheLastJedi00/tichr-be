import { IsString, MaxLength, MinLength } from 'class-validator';

export class EntrarIsolateusDto {
  /** O Voto de Silêncio: ninguém usa o nome verdadeiro (§2). */
  @IsString()
  @MinLength(2)
  @MaxLength(24)
  pseudonimo: string;
}

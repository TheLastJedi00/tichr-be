import { IsString, MaxLength, MinLength } from 'class-validator';

export class RenomearIsolateusDto {
  /** O novo pseudônimo do habitante, escolhido pelo professor. */
  @IsString()
  @MinLength(2)
  @MaxLength(24)
  pseudonimo: string;
}

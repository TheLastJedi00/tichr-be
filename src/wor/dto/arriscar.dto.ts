import { IsString, MaxLength, MinLength } from 'class-validator';

export class ArriscarDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  palavra: string;
}

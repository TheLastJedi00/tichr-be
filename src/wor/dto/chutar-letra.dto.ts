import { IsString, Length } from 'class-validator';

export class ChutarLetraDto {
  @IsString()
  @Length(1, 1)
  letra: string;
}

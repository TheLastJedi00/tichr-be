import { IsString, MaxLength, MinLength } from 'class-validator';

export class SalvarPromptDto {
  @IsString()
  @MinLength(20)
  @MaxLength(4000)
  template: string;
}

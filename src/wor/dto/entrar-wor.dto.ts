import { IsOptional, IsString, MaxLength } from 'class-validator';

export class EntrarWorDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  nome?: string;
}

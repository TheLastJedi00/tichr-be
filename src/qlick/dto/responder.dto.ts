import { IsInt, Min } from 'class-validator';

export class ResponderDto {
  @IsInt()
  @Min(0)
  alternativaIndex: number;
}

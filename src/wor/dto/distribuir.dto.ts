import { IsInt, Max, Min } from 'class-validator';

export class DistribuirDto {
  @IsInt()
  @Min(2)
  @Max(6)
  numeroEquipes: number;
}

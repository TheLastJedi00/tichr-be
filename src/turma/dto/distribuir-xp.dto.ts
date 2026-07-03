import { IsInt, IsOptional, IsString, MaxLength, Min, Max } from 'class-validator';

export class DistribuirXpDto {
  /** Pontos a somar (positivo) ou subtrair (negativo). */
  @IsInt()
  @Min(-1000)
  @Max(1000)
  pontos: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  motivo?: string;
}

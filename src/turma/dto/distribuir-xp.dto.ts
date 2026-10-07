import { IsInt, IsOptional, IsString, MaxLength, Min, Max } from 'class-validator';

export class DistribuirXpDto {
  /** Pontos a somar (positivo) ou subtrair (negativo). */
  @IsInt()
  @Min(-99999)
  @Max(99999)
  pontos: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  motivo?: string;
}

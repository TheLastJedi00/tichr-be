import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Parametros de um sorteio de squads. */
export class CreateAgrupamentoDto {
  @IsInt()
  @Min(1)
  @Max(50)
  numeroEquipes: number;

  /** Papeis distribuidos sequencialmente dentro de cada equipe. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  papeis?: string[];

  /** Temas sorteados (um por equipe). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  temas?: string[];
}

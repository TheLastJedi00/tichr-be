import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Pedido de geração de dicas por IA para uma palavra secreta. */
export class GerarDicasDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  topico: string;

  @IsString()
  @MinLength(1)
  @MaxLength(40)
  palavra: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  disciplina?: string;
}

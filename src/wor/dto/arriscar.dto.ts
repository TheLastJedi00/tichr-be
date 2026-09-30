import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/** O que a equipe comum ganha ao acertar a palavra inteira. */
export type EfeitoRisco = 'CURAR' | 'CATAPULTA';

export class ArriscarDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  palavra: string;

  /**
   * Recuperar HP do próprio castelo (padrão — clientes antigos não mandam) ou
   * disparar a Catapulta num castelo rival. Ignorado pela Horda (Usurpação).
   */
  @IsOptional()
  @IsIn(['CURAR', 'CATAPULTA'])
  efeito?: EfeitoRisco;

  /** Castelo alvo da Catapulta. */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  alvoEquipeId?: string;
}

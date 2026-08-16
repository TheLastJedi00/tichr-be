import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { SETOR_IDS } from '../isolateus.data';

/**
 * A jogada da Ameaça na noite.
 *
 * `SABOTAR` não precisa de alvo: sabota-se o setor onde se está, e o servidor
 * usa a posição do habitante em vez do que o cliente mandou.
 *
 * `ABDUZIR` aceita **uma** das duas formas:
 * *   `alvoId` → presencial, escolhendo a vítima na fileira do próprio setor;
 * *   `setorId` → às cegas, apostando num setor sem saber quem está lá.
 */
export class AcaoAmeacaDto {
  @IsIn(['SABOTAR', 'ABDUZIR', 'AGUARDAR'])
  tipo: 'SABOTAR' | 'ABDUZIR' | 'AGUARDAR';

  /** Habitante alvo (abdução presencial). */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  alvoId?: string;

  /** Setor apostado (abdução às cegas). */
  @IsOptional()
  @IsString()
  @IsIn(SETOR_IDS)
  setorId?: string;
}

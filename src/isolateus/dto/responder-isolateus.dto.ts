import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { DefinirCronometroDto } from '../../common/entrada';
import { ISOLATEUS } from '../entities/isolateus-match.entity';

const OPCOES_NOITE: number[] = [...ISOLATEUS.OPCOES_NOITE_S];

export class ResponderIsolateusDto {
  @IsInt()
  @Min(0)
  alternativaIndex: number;
}

/** Mensagem curta: o Sinal Interceptado. */
export class MensagemDto {
  @IsString()
  @MaxLength(240)
  texto: string;
}

/** Uma fala no chat da vila (036 #29): de 1 a 200 caracteres. */
export class ChatVilaDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  texto: string;
}

/** Voto da Quarentena: o habitante suspeito. */
export class VotarSuspeitoDto {
  @IsString()
  @MaxLength(60)
  suspeitoId: string;
}

/** O professor pode nomear a partida ao criá-la a partir da investigação. */
export class CriarPartidaIsolateusDto {
  @IsOptional()
  @IsString()
  turmaId?: string;
}

/** Opções escolhidas no lobby, fixadas no Despertar. */
export class IniciarPartidaIsolateusDto {
  /**
   * Ignorado desde a 036 (#36): o chat da vila substituiu o debate. Fica na
   * DTO para um telão antigo, no meio do deploy, não receber 400.
   */
  @IsOptional()
  @IsBoolean()
  debateHabilitado?: boolean;

  /** Tempo de movimentação = duração da noite (036 #2). Ausente = o do lobby. */
  @IsOptional()
  @IsIn(OPCOES_NOITE)
  segundosNoite?: number;
}

/**
 * Cronômetro de entrada (035). Leva o tempo de movimentação escolhido no
 * lobby, porque o início pelo cronômetro pode sair da leitura de um aluno.
 */
export class DefinirCronometroIsolateusDto extends DefinirCronometroDto {
  /** Ignorado desde a 036 (#36); ver `IniciarPartidaIsolateusDto`. */
  @IsOptional()
  @IsBoolean()
  debateHabilitado?: boolean;

  @IsOptional()
  @IsIn(OPCOES_NOITE)
  segundosNoite?: number;
}

/** O voto em quem volta pelo resgate (025 §6.4). */
export class VotarResgateDto {
  @IsString()
  @MaxLength(60)
  habitanteId: string;
}

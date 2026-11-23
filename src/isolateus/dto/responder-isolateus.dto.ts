import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { DefinirCronometroDto } from '../../common/entrada';

export class ResponderIsolateusDto {
  @IsInt()
  @Min(0)
  alternativaIndex: number;
}

/** Mensagem curta: sinal de rádio ou fala do debate. */
export class MensagemDto {
  @IsString()
  @MaxLength(240)
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
  /** Debate Tático antes da votação da Quarentena. Ausente = ligado. */
  @IsOptional()
  @IsBoolean()
  debateHabilitado?: boolean;
}

/**
 * Cronômetro de entrada (035). Leva o debate escolhido no lobby, porque o
 * início pelo cronômetro pode sair da leitura de um aluno, sem o professor.
 */
export class DefinirCronometroIsolateusDto extends DefinirCronometroDto {
  @IsOptional()
  @IsBoolean()
  debateHabilitado?: boolean;
}

/** O voto em quem volta pelo resgate (025 §6.4). */
export class VotarResgateDto {
  @IsString()
  @MaxLength(60)
  habitanteId: string;
}

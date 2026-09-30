import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

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

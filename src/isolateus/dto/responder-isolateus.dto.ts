import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class ResponderIsolateusDto {
  @IsInt()
  @Min(0)
  alternativaIndex: number;
}

/** O Alienígena forja um argumento defendendo uma solução falsa (§4). */
export class ForjarRumorDto {
  @IsString()
  @MaxLength(240)
  texto: string;
}

/** Mensagem curta: rumor no chat da rodada, sinal de rádio ou fala do debate. */
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

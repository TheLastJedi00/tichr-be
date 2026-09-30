import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export type PoderAlienigena = 'CONTROLE' | 'CONTAGIO' | 'DELIRIO';
export const PODERES: PoderAlienigena[] = ['CONTROLE', 'CONTAGIO', 'DELIRIO'];

/**
 * O Poder Alienígena escolhido pela Ameaça que acertou a questão.
 *
 * `alvoId` só vale para o Controle Mental (o habitante controlado). O Contágio
 * não tem alvo: o servidor sorteia entre os aldeões reais — se a Ameaça
 * escolhesse e o contágio falhasse num NPC, ela descobriria quem é virtual.
 */
export class UsarPoderDto {
  @IsIn(PODERES)
  poder: PoderAlienigena;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  alvoId?: string;
}

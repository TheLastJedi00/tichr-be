import { IsIn, IsOptional, IsString } from 'class-validator';
import type { AcaoDilema } from '../wor-game.service';

export class DilemaDto {
  @IsIn(['ATACAR', 'COMPRAR_DICA'])
  acao: AcaoDilema;

  @IsOptional()
  @IsString()
  alvoEquipeId?: string;
}

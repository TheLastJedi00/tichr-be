import { IsIn } from 'class-validator';
import type { MetodoCobranca } from '../entities/cobranca.entity';

export class IniciarSlotDto {
  @IsIn(['PIX', 'CARTAO'])
  metodo: MetodoCobranca;
}

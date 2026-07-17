import { IsIn, IsOptional, IsString } from 'class-validator';
import type { PlanoAtual } from '../../professor/entities/professor.entity';
import type { MetodoCobranca } from '../entities/cobranca.entity';

export class IniciarUpgradeDto {
  @IsIn(['ESTAGIARIO', 'GRADUADO', 'MESTRE', 'PHD'])
  plano: PlanoAtual;

  @IsIn(['PIX', 'CARTAO'])
  metodo: MetodoCobranca;

  /** Codigo de cupom de desconto aplicado na cobranca (opcional). */
  @IsOptional()
  @IsString()
  cupom?: string;
}

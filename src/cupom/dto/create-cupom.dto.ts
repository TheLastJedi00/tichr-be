import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import type { PlanoAtual } from '../../professor/entities/professor.entity';
import type { TipoCupom, TipoDesconto } from '../entities/cupom.entity';

export class CreateCupomDto {
  @IsString()
  @MinLength(3)
  codigo: string;

  @IsIn(['PLANO_GRATIS', 'MESES_GRATIS'])
  tipo: TipoCupom;

  @IsOptional()
  @IsIn(['ESTAGIARIO', 'GRADUADO', 'MESTRE', 'PHD'])
  planoConcedido?: PlanoAtual;

  @IsOptional()
  @IsInt()
  @Min(1)
  meses?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxUsos?: number;

  @IsOptional()
  @IsBoolean()
  ativo?: boolean;

  /** Tipo de desconto no gateway (default PERCENTAGE 100 = cortesia total). */
  @IsOptional()
  @IsIn(['PERCENTAGE', 'FIXED'])
  discountKind?: TipoDesconto;

  /** Valor do desconto: 1-100 (PERCENTAGE) ou centavos (FIXED). */
  @IsOptional()
  @IsInt()
  @Min(1)
  discount?: number;
}

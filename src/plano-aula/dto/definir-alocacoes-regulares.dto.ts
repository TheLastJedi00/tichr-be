import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/** Estado completo de uma Unidade Eletiva: a ordem dos topicoIds e a numeracao. */
export class UnidadeAlocacaoDto {
  @IsInt()
  @Min(1)
  @Max(4)
  unidade: number;

  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  topicoIds: string[];
}

/**
 * Board completo das alocacoes regulares de uma turma. O backend regrava todas
 * as alocacoes regulares (por unidade) de forma idempotente — `ordem` = indice.
 */
export class DefinirAlocacoesRegularesDto {
  @IsArray()
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => UnidadeAlocacaoDto)
  unidades: UnidadeAlocacaoDto[];
}

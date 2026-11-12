import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { DENUNCIA } from '../denuncia.constants';
import type { StatusDenuncia } from '../entities/denuncia.entity';

export class CriarTopicoDto {
  @IsString()
  @MinLength(3)
  @MaxLength(80)
  titulo: string;

  @IsInt()
  @Min(0)
  @Max(DENUNCIA.TETO_PONTOS)
  pontosSugeridos: number;
}

export class EditarTopicoDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(80)
  titulo?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(DENUNCIA.TETO_PONTOS)
  pontosSugeridos?: number;

  @IsOptional()
  @IsBoolean()
  ativo?: boolean;
}

/**
 * JSON ou multipart (de um front antigo; a imagem foi removida na 033). O
 * autor e a turma saem do JWT do aluno, nunca daqui.
 */
export class CriarDenunciaDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  denunciadoAlunoId: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  topicoId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(DENUNCIA.TEXTO_MAX)
  texto?: string;
}

export class ValidarDenunciaDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(DENUNCIA.TETO_PONTOS)
  pontos: number;
}

export class ListarDenunciasQuery {
  @IsOptional()
  @IsIn(['PENDENTE', 'VALIDADA', 'INVALIDADA'])
  status?: StatusDenuncia;
}

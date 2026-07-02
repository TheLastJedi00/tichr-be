import { IsIn, IsNotEmpty, IsString, Matches } from 'class-validator';
import type { EscopoExcecao } from '../entities/excecao.entity';

export class CreateExcecaoDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'data deve estar no formato YYYY-MM-DD',
  })
  data: string;

  @IsString()
  @IsNotEmpty()
  motivo: string;

  @IsIn(['GLOBAL', 'ESCOLA', 'PESSOAL'])
  escopo: EscopoExcecao;
}

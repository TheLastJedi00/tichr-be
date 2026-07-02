import { EscopoExcecao } from '../entities/excecao.entity';

export class CreateExcecaoDto {
  data: string;
  motivo: string;
  escopo: EscopoExcecao;
}

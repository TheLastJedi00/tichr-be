import { TipoModalidade } from '../entities/turma.entity';

export class CreateTurmaDto {
  nome: string;
  tipoModalidade: TipoModalidade;
  diasSemana: number[];
  dataInicio: string;
  totalAulas?: number;
}

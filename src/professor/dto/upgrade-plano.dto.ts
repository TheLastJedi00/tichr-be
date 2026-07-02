import { IsIn } from 'class-validator';
import type { PlanoAtual } from '../entities/professor.entity';

export class UpgradePlanoDto {
  @IsIn(['ESTAGIARIO', 'GRADUADO', 'MESTRE', 'PHD'])
  plano: PlanoAtual;
}

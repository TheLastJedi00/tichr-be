import { IsIn } from 'class-validator';
import type { PlanoAtual } from '../../professor/entities/professor.entity';

/** Override manual de plano pelo admin (sem cobranca). */
export class AlterarPlanoDto {
  @IsIn(['ESTAGIARIO', 'GRADUADO', 'MESTRE', 'PHD'])
  plano: PlanoAtual;
}

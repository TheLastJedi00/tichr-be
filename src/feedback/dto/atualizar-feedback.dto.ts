import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { StatusFeedback } from '../entities/feedback.entity';

/**
 * Triagem: mover o status e anotar acontecem no mesmo gesto ("li, e bug
 * conhecido, vou marcar em analise"), entao vao no mesmo PATCH. Ambos
 * opcionais; o que nao vier nao e tocado.
 */
export class AtualizarFeedbackDto {
  @IsOptional()
  @IsIn(['PENDENTE', 'EM_ANALISE', 'RESOLVIDO'])
  status?: StatusFeedback;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notaInterna?: string;
}

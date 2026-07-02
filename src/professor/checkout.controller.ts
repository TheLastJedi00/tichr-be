import { Body, Controller, Post } from '@nestjs/common';
import { ProfessorId } from '../auth/current-user.decorator';
import { UpgradePlanoDto } from './dto/upgrade-plano.dto';
import { ProfessorService } from './professor.service';

/**
 * Transacoes de assinatura (mock — sem gateway de pagamento real ainda).
 * Cada endpoint apenas ajusta o estado do plano no perfil do professor.
 */
@Controller('checkout')
export class CheckoutController {
  constructor(private readonly professorService: ProfessorService) {}

  /** Compra uma vaga avulsa (+1 slot adicional). */
  @Post('slot-avulso')
  comprarSlotAvulso(@ProfessorId() uid: string) {
    return this.professorService.comprarSlotAvulso(uid);
  }

  /** Faz upgrade/downgrade do plano do professor. */
  @Post('upgrade')
  upgrade(@ProfessorId() uid: string, @Body() dto: UpgradePlanoDto) {
    return this.professorService.alterarPlano(uid, dto.plano);
  }
}

import { Module } from '@nestjs/common';
import { ProfessorModule } from '../professor/professor.module';
import { AbacatePayService } from './abacate-pay.service';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';
import { CobrancaRepository } from './cobranca.repository';
import { WebhookController } from './webhook.controller';

/**
 * Integração de pagamentos (Abacate Pay): checkout de assinatura/slot, status
 * para o polling do front e o webhook de confirmação. Importa o ProfessorModule
 * para conceder plano/slot; o AbacatePayService é reusado por outros módulos.
 */
@Module({
  imports: [ProfessorModule],
  controllers: [CheckoutController, WebhookController],
  providers: [AbacatePayService, CheckoutService, CobrancaRepository],
  exports: [AbacatePayService, CobrancaRepository],
})
export class CheckoutModule {}

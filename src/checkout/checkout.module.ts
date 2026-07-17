import { Module } from '@nestjs/common';
import { AbacatePayService } from './abacate-pay.service';
import { CobrancaRepository } from './cobranca.repository';

/**
 * Integração de pagamentos (Abacate Pay). Provê o `AbacatePayService` e o
 * repositório de cobranças; os controllers de checkout/webhook entram na fase 2.
 */
@Module({
  providers: [AbacatePayService, CobrancaRepository],
  exports: [AbacatePayService, CobrancaRepository],
})
export class CheckoutModule {}

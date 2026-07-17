import { Module } from '@nestjs/common';
import { AbacatePayService } from './abacate-pay.service';

/**
 * Integração de pagamentos (Abacate Pay). Por ora provê apenas o
 * `AbacatePayService`; os controllers de checkout/webhook e o repositório de
 * cobranças entram nas fases seguintes.
 */
@Module({
  providers: [AbacatePayService],
  exports: [AbacatePayService],
})
export class CheckoutModule {}

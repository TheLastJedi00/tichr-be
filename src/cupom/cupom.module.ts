import { Module } from '@nestjs/common';
import { CheckoutModule } from '../checkout/checkout.module';
import { AdminCupomController } from './admin-cupom.controller';
import { CupomController } from './cupom.controller';
import { CupomRepository } from './cupom.repository';
import { CupomService } from './cupom.service';

/** Motor de cupons: CRUD no backoffice + aplicacao no checkout do professor. */
@Module({
  // CheckoutModule provê o AbacatePayService (espelho do cupom no gateway).
  imports: [CheckoutModule],
  controllers: [AdminCupomController, CupomController],
  providers: [CupomService, CupomRepository],
})
export class CupomModule {}

import { Module } from '@nestjs/common';
import { AdminCupomController } from './admin-cupom.controller';
import { CupomController } from './cupom.controller';
import { CupomRepository } from './cupom.repository';
import { CupomService } from './cupom.service';

/** Motor de cupons: CRUD no backoffice + aplicacao no checkout do professor. */
@Module({
  controllers: [AdminCupomController, CupomController],
  providers: [CupomService, CupomRepository],
})
export class CupomModule {}

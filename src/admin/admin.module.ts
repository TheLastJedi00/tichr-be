import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';

/** Modulo isolado do backoffice administrativo (metricas, CRM, cupons). */
@Module({
  controllers: [AdminController],
})
export class AdminModule {}

import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { CheckoutController } from './checkout.controller';
import { ProfessorController } from './professor.controller';
import { ProfessorRepository } from './professor.repository';
import { ProfessorService } from './professor.service';

@Module({
  // AdminModule provê o AdminService (cascade de exclusão) reusado na auto-exclusão.
  imports: [AdminModule],
  controllers: [ProfessorController, CheckoutController],
  providers: [ProfessorService, ProfessorRepository],
  exports: [ProfessorService],
})
export class ProfessorModule {}

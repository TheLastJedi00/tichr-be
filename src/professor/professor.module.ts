import { Module } from '@nestjs/common';
import { CheckoutController } from './checkout.controller';
import { ProfessorController } from './professor.controller';
import { ProfessorRepository } from './professor.repository';
import { ProfessorService } from './professor.service';

@Module({
  controllers: [ProfessorController, CheckoutController],
  providers: [ProfessorService, ProfessorRepository],
  exports: [ProfessorService],
})
export class ProfessorModule {}

import { Module } from '@nestjs/common';
import { ProfessorController } from './professor.controller';
import { ProfessorRepository } from './professor.repository';
import { ProfessorService } from './professor.service';

@Module({
  controllers: [ProfessorController],
  providers: [ProfessorService, ProfessorRepository],
  exports: [ProfessorService],
})
export class ProfessorModule {}

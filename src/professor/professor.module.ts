import { Module } from '@nestjs/common';
import { ProfessorRepository } from './professor.repository';
import { ProfessorService } from './professor.service';

@Module({
  providers: [ProfessorService, ProfessorRepository],
  exports: [ProfessorService],
})
export class ProfessorModule {}

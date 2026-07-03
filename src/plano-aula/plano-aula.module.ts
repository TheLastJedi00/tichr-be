import { Module } from '@nestjs/common';
import { ProfessorModule } from '../professor/professor.module';
import { PlanoAulaController } from './plano-aula.controller';
import { PlanoAulaRepository } from './plano-aula.repository';
import { PlanoAulaService } from './plano-aula.service';

/** Modulo independente do Plano de Aula (escopo geral por disciplina). */
@Module({
  imports: [ProfessorModule],
  controllers: [PlanoAulaController],
  providers: [PlanoAulaService, PlanoAulaRepository],
})
export class PlanoAulaModule {}

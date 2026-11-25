import { Module } from '@nestjs/common';
import { AnexoStorage } from '../common/anexo.storage';
import { ProfessorModule } from '../professor/professor.module';
import { TurmaModule } from '../turma/turma.module';
import { AtividadeRepository } from './atividade.repository';
import { EntregaRepository } from './entrega.repository';

/** Envio de trabalhos (spec 038): módulo próprio, sem ciclo com a turma. */
@Module({
  imports: [TurmaModule, ProfessorModule],
  providers: [AtividadeRepository, EntregaRepository, AnexoStorage],
})
export class TrabalhoModule {}

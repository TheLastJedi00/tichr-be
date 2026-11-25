import { Module } from '@nestjs/common';
import { AnexoStorage } from '../common/anexo.storage';
import { ProfessorModule } from '../professor/professor.module';
import { TurmaModule } from '../turma/turma.module';
import { AtividadeRepository } from './atividade.repository';
import { EntregaRepository } from './entrega.repository';
import { TrabalhoController } from './trabalho.controller';
import { TrabalhoService } from './trabalho.service';

/** Envio de trabalhos (spec 038): módulo próprio, sem ciclo com a turma. */
@Module({
  imports: [TurmaModule, ProfessorModule],
  controllers: [TrabalhoController],
  providers: [
    TrabalhoService,
    AtividadeRepository,
    EntregaRepository,
    AnexoStorage,
  ],
})
export class TrabalhoModule {}

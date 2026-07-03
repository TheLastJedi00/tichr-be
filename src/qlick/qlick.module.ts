import { Module } from '@nestjs/common';
import { ProfessorModule } from '../professor/professor.module';
import { TurmaModule } from '../turma/turma.module';
import { QlickController } from './qlick.controller';
import { QlickRepository } from './qlick.repository';
import { QlickService } from './qlick.service';

/** Módulo independente do Tichr Qlick (definição do questionário). */
@Module({
  imports: [ProfessorModule, TurmaModule],
  controllers: [QlickController],
  providers: [QlickService, QlickRepository],
})
export class QlickModule {}

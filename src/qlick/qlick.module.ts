import { Module } from '@nestjs/common';
import { ProfessorModule } from '../professor/professor.module';
import { TurmaModule } from '../turma/turma.module';
import { AlunoQlickController } from './aluno-qlick.controller';
import { PartidaController } from './partida.controller';
import { PartidaRepository } from './partida.repository';
import { PartidaService } from './partida.service';
import { QlickController } from './qlick.controller';
import { QlickRepository } from './qlick.repository';
import { QlickService } from './qlick.service';

/** Módulo independente do Tichr Qlick (definição + partidas em tempo real). */
@Module({
  imports: [ProfessorModule, TurmaModule],
  controllers: [QlickController, PartidaController, AlunoQlickController],
  providers: [QlickService, QlickRepository, PartidaService, PartidaRepository],
})
export class QlickModule {}

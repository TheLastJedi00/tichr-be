import { Module } from '@nestjs/common';
import { ProfessorModule } from '../professor/professor.module';
import { TurmaModule } from '../turma/turma.module';
import { GeminiService } from '../wor/gemini.service';
import { AlunoQlickController } from './aluno-qlick.controller';
import { PartidaController } from './partida.controller';
import { PartidaRepository } from './partida.repository';
import { PartidaService } from './partida.service';
import { QlickController } from './qlick.controller';
import { QlickIaService } from './qlick-ia.service';
import { QlickRepository } from './qlick.repository';
import { QlickService } from './qlick.service';

/** Módulo independente do Tichr Qlick (definição + partidas + geração por IA). */
@Module({
  imports: [ProfessorModule, TurmaModule],
  controllers: [QlickController, PartidaController, AlunoQlickController],
  providers: [
    QlickService,
    QlickRepository,
    PartidaService,
    PartidaRepository,
    // GeminiService reprovido localmente (o WorModule não o exporta) + IA do Qlick.
    GeminiService,
    QlickIaService,
  ],
})
export class QlickModule {}

import { Module } from '@nestjs/common';
import { ProfessorModule } from '../professor/professor.module';
import { TurmaModule } from '../turma/turma.module';
import { GeminiService } from '../wor/gemini.service';
import { IsolateusIaService } from './isolateus-ia.service';
import { IsolateusJogoController } from './isolateus-jogo.controller';
import { IsolateusJogoRepository } from './isolateus-jogo.repository';
import { IsolateusJogoService } from './isolateus-jogo.service';

/** Módulo independente do Tichr Isolateus (definição + partidas + geração por IA). */
@Module({
  imports: [ProfessorModule, TurmaModule],
  controllers: [IsolateusJogoController],
  providers: [
    IsolateusJogoService,
    IsolateusJogoRepository,
    // GeminiService reprovido localmente (o WorModule não o exporta) + IA do Isolateus.
    GeminiService,
    IsolateusIaService,
  ],
})
export class IsolateusModule {}

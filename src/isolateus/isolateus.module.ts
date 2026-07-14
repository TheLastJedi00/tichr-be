import { Module } from '@nestjs/common';
import { ProfessorModule } from '../professor/professor.module';
import { TurmaModule } from '../turma/turma.module';
import { GeminiService } from '../wor/gemini.service';
import { AlunoIsolateusController } from './aluno-isolateus.controller';
import { IsolateusGameService } from './isolateus-game.service';
import { IsolateusIaService } from './isolateus-ia.service';
import { IsolateusJogoController } from './isolateus-jogo.controller';
import { IsolateusJogoRepository } from './isolateus-jogo.repository';
import { IsolateusJogoService } from './isolateus-jogo.service';
import { IsolateusMatchController } from './isolateus-match.controller';
import { IsolateusMatchRepository } from './isolateus-match.repository';
import { IsolateusMatchService } from './isolateus-match.service';

/** Módulo independente do Tichr Isolateus (definição + partidas + geração por IA). */
@Module({
  imports: [ProfessorModule, TurmaModule],
  controllers: [
    IsolateusJogoController,
    IsolateusMatchController,
    AlunoIsolateusController,
  ],
  providers: [
    IsolateusJogoService,
    IsolateusJogoRepository,
    IsolateusMatchService,
    IsolateusMatchRepository,
    IsolateusGameService,
    // GeminiService reprovido localmente (o WorModule não o exporta) + IA do Isolateus.
    GeminiService,
    IsolateusIaService,
  ],
})
export class IsolateusModule {}

import { Module } from '@nestjs/common';
import { ProfessorModule } from '../professor/professor.module';
import { TurmaModule } from '../turma/turma.module';
import { IsolateusJogoController } from './isolateus-jogo.controller';
import { IsolateusJogoRepository } from './isolateus-jogo.repository';
import { IsolateusJogoService } from './isolateus-jogo.service';

/** Módulo independente do Tichr Isolateus (definição + partidas + geração por IA). */
@Module({
  imports: [ProfessorModule, TurmaModule],
  controllers: [IsolateusJogoController],
  providers: [IsolateusJogoService, IsolateusJogoRepository],
})
export class IsolateusModule {}

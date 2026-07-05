import { Module } from '@nestjs/common';
import { ProfessorModule } from '../professor/professor.module';
import { AlunoWorController } from './aluno-wor.controller';
import { GeminiService } from './gemini.service';
import { WorIaService } from './wor-ia.service';
import { WorJogoController } from './wor-jogo.controller';
import { WorJogoRepository } from './wor-jogo.repository';
import { WorJogoService } from './wor-jogo.service';
import { WorMatchController } from './wor-match.controller';
import { WorMatchRepository } from './wor-match.repository';
import { WorMatchService } from './wor-match.service';

/** Módulo independente do Tichr Wor (arsenal + IA de dicas + partidas). */
@Module({
  imports: [ProfessorModule],
  controllers: [WorJogoController, WorMatchController, AlunoWorController],
  providers: [
    WorJogoService,
    WorJogoRepository,
    GeminiService,
    WorIaService,
    WorMatchService,
    WorMatchRepository,
  ],
})
export class WorModule {}

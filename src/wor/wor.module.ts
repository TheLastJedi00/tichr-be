import { Module } from '@nestjs/common';
import { ProfessorModule } from '../professor/professor.module';
import { TurmaModule } from '../turma/turma.module';
import { IaGovernancaModule } from '../ia-governanca/ia-governanca.module';
import { AlunoWorController } from './aluno-wor.controller';
import { GeminiService } from './gemini.service';
import { WorIaService } from './wor-ia.service';
import { WorJogoController } from './wor-jogo.controller';
import { WorJogoRepository } from './wor-jogo.repository';
import { WorJogoService } from './wor-jogo.service';
import { WorGameService } from './wor-game.service';
import { WorMatchController } from './wor-match.controller';
import { WorMatchRepository } from './wor-match.repository';
import { WorMatchService } from './wor-match.service';

/** Módulo independente do Tichr Wor (arsenal + IA de dicas + partidas). */
@Module({
  // TurmaModule exporta o XpService (crédito de pontos no ranking da sala).
  imports: [ProfessorModule, TurmaModule, IaGovernancaModule],
  controllers: [WorJogoController, WorMatchController, AlunoWorController],
  providers: [
    WorJogoService,
    WorJogoRepository,
    GeminiService,
    WorIaService,
    WorMatchService,
    WorMatchRepository,
    WorGameService,
  ],
})
export class WorModule {}

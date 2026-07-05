import { Module } from '@nestjs/common';
import { ProfessorModule } from '../professor/professor.module';
import { GeminiService } from './gemini.service';
import { WorIaService } from './wor-ia.service';
import { WorJogoController } from './wor-jogo.controller';
import { WorJogoRepository } from './wor-jogo.repository';
import { WorJogoService } from './wor-jogo.service';

/** Módulo independente do Tichr Wor (arsenal + IA de dicas + partidas). */
@Module({
  imports: [ProfessorModule],
  controllers: [WorJogoController],
  providers: [WorJogoService, WorJogoRepository, GeminiService, WorIaService],
})
export class WorModule {}

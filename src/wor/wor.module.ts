import { Module } from '@nestjs/common';
import { WorJogoController } from './wor-jogo.controller';
import { WorJogoRepository } from './wor-jogo.repository';
import { WorJogoService } from './wor-jogo.service';

/** Módulo independente do Tichr Wor (arsenal + partidas em tempo real). */
@Module({
  controllers: [WorJogoController],
  providers: [WorJogoService, WorJogoRepository],
})
export class WorModule {}

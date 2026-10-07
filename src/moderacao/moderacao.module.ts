import { Module } from '@nestjs/common';
import { ModeracaoService } from './moderacao.service';

/** Filtro de linguagem imprópria, compartilhado pelos jogos. */
@Module({
  providers: [ModeracaoService],
  exports: [ModeracaoService],
})
export class ModeracaoModule {}

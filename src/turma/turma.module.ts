import { Module } from '@nestjs/common';
import { ExcecaoRepository } from './repositories/excecao.repository';
import { SessaoRepository } from './repositories/sessao.repository';
import { TurmaRepository } from './repositories/turma.repository';
import { TurmaController } from './turma.controller';
import { TurmaService } from './turma.service';

@Module({
  controllers: [TurmaController],
  providers: [
    TurmaService,
    TurmaRepository,
    SessaoRepository,
    ExcecaoRepository,
  ],
})
export class TurmaModule {}

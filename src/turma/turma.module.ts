import { Module } from '@nestjs/common';
import { ExcecaoRepository } from './repositories/excecao.repository';
import { FeriasRepository } from './repositories/ferias.repository';
import { SessaoRepository } from './repositories/sessao.repository';
import { TurmaRepository } from './repositories/turma.repository';
import { FeriasController } from './ferias.controller';
import { TurmaController } from './turma.controller';
import { TurmaService } from './turma.service';

@Module({
  controllers: [TurmaController, FeriasController],
  providers: [
    TurmaService,
    TurmaRepository,
    SessaoRepository,
    ExcecaoRepository,
    FeriasRepository,
  ],
})
export class TurmaModule {}

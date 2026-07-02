import { Module } from '@nestjs/common';
import { ProfessorModule } from '../professor/professor.module';
import { ExcecaoRepository } from './repositories/excecao.repository';
import { FeriasRepository } from './repositories/ferias.repository';
import { SessaoRepository } from './repositories/sessao.repository';
import { TurmaRepository } from './repositories/turma.repository';
import { FeriasController } from './ferias.controller';
import { PlanosGuard } from './planos.guard';
import { TurmaController } from './turma.controller';
import { TurmaService } from './turma.service';

@Module({
  imports: [ProfessorModule],
  controllers: [TurmaController, FeriasController],
  providers: [
    TurmaService,
    TurmaRepository,
    SessaoRepository,
    ExcecaoRepository,
    FeriasRepository,
    PlanosGuard,
  ],
})
export class TurmaModule {}

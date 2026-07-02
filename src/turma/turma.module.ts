import { Module } from '@nestjs/common';
import { ProfessorModule } from '../professor/professor.module';
import { AlunoRepository } from './repositories/aluno.repository';
import { ExcecaoRepository } from './repositories/excecao.repository';
import { FeriasRepository } from './repositories/ferias.repository';
import { SessaoRepository } from './repositories/sessao.repository';
import { TurmaRepository } from './repositories/turma.repository';
import { AlunoController } from './aluno.controller';
import { AlunoService } from './aluno.service';
import { FeriasController } from './ferias.controller';
import { PlanosGuard } from './planos.guard';
import { TurmaController } from './turma.controller';
import { TurmaService } from './turma.service';

@Module({
  imports: [ProfessorModule],
  controllers: [TurmaController, FeriasController, AlunoController],
  providers: [
    TurmaService,
    TurmaRepository,
    SessaoRepository,
    ExcecaoRepository,
    FeriasRepository,
    AlunoRepository,
    AlunoService,
    PlanosGuard,
  ],
})
export class TurmaModule {}

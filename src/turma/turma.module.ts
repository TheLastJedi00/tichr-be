import { Module } from '@nestjs/common';
import { ProfessorModule } from '../professor/professor.module';
import { AlunoRepository } from './repositories/aluno.repository';
import { EquipeRepository } from './repositories/equipe.repository';
import { ExcecaoRepository } from './repositories/excecao.repository';
import { FeriasRepository } from './repositories/ferias.repository';
import { SessaoRepository } from './repositories/sessao.repository';
import { TurmaRepository } from './repositories/turma.repository';
import { XpLogRepository } from './repositories/xp-log.repository';
import { AgrupamentoController } from './agrupamento.controller';
import { AgrupamentoService } from './agrupamento.service';
import { AlunoController } from './aluno.controller';
import { AlunoPortalController } from './aluno-portal.controller';
import { AlunoService } from './aluno.service';
import { EquipeController } from './equipe.controller';
import { EquipeService } from './equipe.service';
import { FeriasController } from './ferias.controller';
import { PlanosGuard } from './planos.guard';
import { RankingController } from './ranking.controller';
import { TurmaController } from './turma.controller';
import { TurmaService } from './turma.service';
import { XpService } from './xp.service';

@Module({
  imports: [ProfessorModule],
  controllers: [
    TurmaController,
    FeriasController,
    AlunoController,
    AlunoPortalController,
    AgrupamentoController,
    RankingController,
    EquipeController,
  ],
  providers: [
    TurmaService,
    TurmaRepository,
    SessaoRepository,
    ExcecaoRepository,
    FeriasRepository,
    AlunoRepository,
    EquipeRepository,
    AlunoService,
    EquipeService,
    AgrupamentoService,
    XpLogRepository,
    XpService,
    PlanosGuard,
  ],
})
export class TurmaModule {}

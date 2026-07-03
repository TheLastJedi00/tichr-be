import { Module } from '@nestjs/common';
import { ProfessorModule } from '../professor/professor.module';
import { AlunoRepository } from './repositories/aluno.repository';
import { CargoRepository } from './repositories/cargo.repository';
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
import { CargoController } from './cargo.controller';
import { CargoService } from './cargo.service';
import { EquipeController } from './equipe.controller';
import { EquipeService } from './equipe.service';
import { FeriasController } from './ferias.controller';
import { PlanosGuard } from './planos.guard';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';
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
    CargoController,
    PortalController,
  ],
  providers: [
    TurmaService,
    TurmaRepository,
    SessaoRepository,
    ExcecaoRepository,
    FeriasRepository,
    AlunoRepository,
    EquipeRepository,
    CargoRepository,
    AlunoService,
    EquipeService,
    CargoService,
    PortalService,
    AgrupamentoService,
    XpLogRepository,
    XpService,
    PlanosGuard,
  ],
  exports: [TurmaService, TurmaRepository, AlunoRepository, XpService],
})
export class TurmaModule {}

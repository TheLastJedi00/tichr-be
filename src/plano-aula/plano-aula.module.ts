import { Module } from '@nestjs/common';
import { ProfessorModule } from '../professor/professor.module';
import { TurmaModule } from '../turma/turma.module';
import { AlocacaoController } from './alocacao.controller';
import { AlocacaoRepository } from './alocacao.repository';
import { AlocacaoService } from './alocacao.service';
import { PlanoAulaController } from './plano-aula.controller';
import { PlanoAulaRepository } from './plano-aula.repository';
import { PlanoAulaService } from './plano-aula.service';
import { TopicoController } from './topico.controller';
import { TopicoRepository } from './topico.repository';
import { TopicoService } from './topico.service';

/**
 * Modulo independente do Plano de Aula: escopo geral (Graduado), topicos +
 * alocacao por drag&drop (Mestre) e, adiante, sincronizacao com o portal (PhD).
 */
@Module({
  imports: [ProfessorModule, TurmaModule],
  controllers: [PlanoAulaController, TopicoController, AlocacaoController],
  providers: [
    PlanoAulaService,
    PlanoAulaRepository,
    TopicoService,
    TopicoRepository,
    AlocacaoService,
    AlocacaoRepository,
  ],
})
export class PlanoAulaModule {}

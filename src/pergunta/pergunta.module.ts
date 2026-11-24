import { Module } from '@nestjs/common';
import { ProfessorModule } from '../professor/professor.module';
import { TurmaModule } from '../turma/turma.module';
import { AlunoPerguntaController } from './aluno-pergunta.controller';
import { PerguntaController } from './pergunta.controller';
import { PerguntaMensagemRepository } from './pergunta-mensagem.repository';
import { PerguntaRepository } from './pergunta.repository';
import { PerguntaService } from './pergunta.service';

/** Perguntas ao professor (spec 037): módulo próprio, sem ciclo com a turma. */
@Module({
  imports: [TurmaModule, ProfessorModule],
  controllers: [PerguntaController, AlunoPerguntaController],
  providers: [PerguntaService, PerguntaRepository, PerguntaMensagemRepository],
})
export class PerguntaModule {}

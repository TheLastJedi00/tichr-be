import { Module } from '@nestjs/common';
import { ProfessorModule } from '../professor/professor.module';
import { TurmaModule } from '../turma/turma.module';
import { AlunoDenunciaController } from './aluno-denuncia.controller';
import { DenunciaController } from './denuncia.controller';
import { DenunciaImagemStorage } from './denuncia-imagem.storage';
import { DenunciaGrupoRepository } from './denuncia-grupo.repository';
import { DenunciaJanelaRepository } from './denuncia-janela.repository';
import { DenunciaTopicoRepository } from './denuncia-topico.repository';
import { DenunciaRepository } from './denuncia.repository';
import { DenunciaService } from './denuncia.service';

/** Denúncia entre alunos (spec 032): módulo próprio, sem ciclo com a turma. */
@Module({
  imports: [TurmaModule, ProfessorModule],
  controllers: [DenunciaController, AlunoDenunciaController],
  providers: [
    DenunciaService,
    DenunciaRepository,
    DenunciaTopicoRepository,
    DenunciaImagemStorage,
    DenunciaJanelaRepository,
    DenunciaGrupoRepository,
  ],
})
export class DenunciaModule {}

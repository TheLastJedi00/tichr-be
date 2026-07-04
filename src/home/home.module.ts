import { Module } from '@nestjs/common';
import { ProfessorModule } from '../professor/professor.module';
import { TurmaModule } from '../turma/turma.module';
import { HomeController } from './home.controller';
import { HomeService } from './home.service';

/**
 * Modulo agregador (BFF). Injeta os servicos de dominio (perfil + turmas) e
 * expoe um endpoint unico para o painel, evitando o efeito cascata no front.
 */
@Module({
  imports: [ProfessorModule, TurmaModule],
  controllers: [HomeController],
  providers: [HomeService],
})
export class HomeModule {}

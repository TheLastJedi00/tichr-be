import {
  Controller,
  ForbiddenException,
  Get,
  Param,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { RequestUser } from '../auth/auth.types';
import { Roles } from '../auth/roles.decorator';
import { AlunoService } from './aluno.service';

/**
 * Ranking de XP da turma. Acessivel pelo professor dono da turma e pelos
 * alunos da propria turma (portal gamificado).
 */
@Controller('turmas/:turmaId/ranking')
@Roles('PROFESSOR', 'STUDENT')
export class RankingController {
  constructor(private readonly alunoService: AlunoService) {}

  @Get()
  async ranking(
    @CurrentUser() user: RequestUser,
    @Param('turmaId') turmaId: string,
  ) {
    if (user.role === 'STUDENT') {
      if (user.turmaId !== turmaId) {
        throw new ForbiddenException('Voce so pode ver o ranking da sua turma.');
      }
    } else {
      // Professor: precisa ser o dono da turma.
      await this.alunoService.garantirPosse(user.uid, turmaId);
    }
    return this.alunoService.ranking(turmaId);
  }
}

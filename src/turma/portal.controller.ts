import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { DesbloquearTurmaDto } from './dto/desbloquear-turma.dto';
import { PortalService } from './portal.service';

/** Jornada pública de acesso do aluno (busca por @username + PIN da turma). */
@Controller('portal')
export class PortalController {
  constructor(private readonly portalService: PortalService) {}

  @Public()
  @Get('professor/:username/turmas')
  turmas(@Param('username') username: string) {
    return this.portalService.turmasAtivas(username);
  }

  /** Hall da Fama: turmas encerradas do professor (mural público, sem PIN). */
  @Public()
  @Get('professor/:username/hall')
  hall(@Param('username') username: string) {
    return this.portalService.hall(username);
  }

  /** Mural público de uma turma encerrada (roster + ranking final, sem PIN). */
  @Public()
  @Get('turma/:turmaId/hall')
  hallTurma(@Param('turmaId') turmaId: string) {
    return this.portalService.hallTurma(turmaId);
  }

  @Public()
  @Post('turma/:turmaId/alunos')
  desbloquear(
    @Param('turmaId') turmaId: string,
    @Body() dto: DesbloquearTurmaDto,
  ) {
    return this.portalService.desbloquear(turmaId, dto.pinTurma);
  }
}

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

  @Public()
  @Post('turma/:turmaId/alunos')
  desbloquear(
    @Param('turmaId') turmaId: string,
    @Body() dto: DesbloquearTurmaDto,
  ) {
    return this.portalService.desbloquear(turmaId, dto.pinTurma);
  }
}

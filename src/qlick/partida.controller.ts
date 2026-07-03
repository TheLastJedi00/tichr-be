import { Controller, Get, Param, Post } from '@nestjs/common';
import { ProfessorId } from '../auth/current-user.decorator';
import { PartidaService } from './partida.service';

/** Controle da partida pelo professor (comandos via REST). */
@Controller()
export class PartidaController {
  constructor(private readonly partidaService: PartidaService) {}

  @Post('qlicks/:qlickId/partida')
  criar(
    @ProfessorId() professorId: string,
    @Param('qlickId') qlickId: string,
  ) {
    return this.partidaService.criar(professorId, qlickId);
  }

  @Get('partidas/:id')
  obter(@ProfessorId() professorId: string, @Param('id') id: string) {
    return this.partidaService.obterDoProfessor(professorId, id);
  }
}

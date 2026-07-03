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

  @Post('partidas/:id/iniciar')
  iniciar(@ProfessorId() professorId: string, @Param('id') id: string) {
    return this.partidaService.iniciar(professorId, id);
  }

  @Post('partidas/:id/apurar')
  apurar(@ProfessorId() professorId: string, @Param('id') id: string) {
    return this.partidaService.apurarComando(professorId, id);
  }

  @Post('partidas/:id/proxima')
  proxima(@ProfessorId() professorId: string, @Param('id') id: string) {
    return this.partidaService.proxima(professorId, id);
  }

  @Post('partidas/:id/encerrar')
  encerrar(@ProfessorId() professorId: string, @Param('id') id: string) {
    return this.partidaService.encerrar(professorId, id);
  }
}

import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ProfessorId } from '../auth/current-user.decorator';
import { DefinirValeRankingDto } from '../common/vale-ranking';
import { PartidaService } from './partida.service';

/** Controle da partida pelo professor (comandos via REST). */
@Controller()
export class PartidaController {
  constructor(private readonly partidaService: PartidaService) {}

  @Post('qlicks/:qlickId/partida')
  criar(
    @ProfessorId() professorId: string,
    @Param('qlickId') qlickId: string,
    @Body() dto: { turmaId?: string },
  ) {
    return this.partidaService.criar(professorId, qlickId, dto?.turmaId);
  }

  @Get('partidas/:id')
  obter(@ProfessorId() professorId: string, @Param('id') id: string) {
    return this.partidaService.obterDoProfessor(professorId, id);
  }

  /** Lobby: a partida vale para o ranking da turma ou é casual. */
  @Post('partidas/:id/vale-ranking')
  valeRanking(
    @ProfessorId() professorId: string,
    @Param('id') id: string,
    @Body() dto: DefinirValeRankingDto,
  ) {
    return this.partidaService.definirValeRanking(
      professorId,
      id,
      dto.valeRanking,
    );
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

  /** Pausa a partida em andamento: todo comando responde 409 até retomar. */
  @Post('partidas/:id/pausar')
  pausar(@ProfessorId() professorId: string, @Param('id') id: string) {
    return this.partidaService.pausar(professorId, id);
  }

  /** Retoma: o relógio da pergunta volta com o tempo que faltava. */
  @Post('partidas/:id/retomar')
  retomar(@ProfessorId() professorId: string, @Param('id') id: string) {
    return this.partidaService.retomar(professorId, id);
  }

  @Post('partidas/:id/encerrar')
  encerrar(@ProfessorId() professorId: string, @Param('id') id: string) {
    return this.partidaService.encerrar(professorId, id);
  }
}

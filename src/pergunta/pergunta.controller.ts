import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ProfessorId } from '../auth/current-user.decorator';
import { ListarPerguntasQuery, RespostaProfessorDto } from './dto/pergunta.dto';
import { PerguntaService } from './pergunta.service';

/** Lado do professor das perguntas ao professor (spec 037). */
@Controller()
export class PerguntaController {
  constructor(private readonly service: PerguntaService) {}

  @Get('perguntas/pendentes')
  pendentes(@ProfessorId() professorId: string) {
    return this.service.pendentesPorTurma(professorId);
  }

  @Get('turmas/:turmaId/perguntas')
  listar(
    @ProfessorId() professorId: string,
    @Param('turmaId') turmaId: string,
    @Query() query: ListarPerguntasQuery,
  ) {
    return this.service.listarDaTurma(professorId, turmaId, query.status);
  }

  // Antes de `:id`, para "estado" não ser lido como id de pergunta.
  @Get('turmas/:turmaId/perguntas/estado')
  estado(
    @ProfessorId() professorId: string,
    @Param('turmaId') turmaId: string,
  ) {
    return this.service.estadoJanela(professorId, turmaId);
  }

  @Post('turmas/:turmaId/perguntas/abrir')
  abrir(@ProfessorId() professorId: string, @Param('turmaId') turmaId: string) {
    return this.service.abrirJanela(professorId, turmaId);
  }

  @Post('turmas/:turmaId/perguntas/fechar')
  fechar(
    @ProfessorId() professorId: string,
    @Param('turmaId') turmaId: string,
  ) {
    return this.service.fecharJanela(professorId, turmaId);
  }

  @Get('turmas/:turmaId/perguntas/:id')
  detalhe(
    @ProfessorId() professorId: string,
    @Param('turmaId') turmaId: string,
    @Param('id') id: string,
  ) {
    return this.service.detalheDoProfessor(professorId, turmaId, id);
  }

  @Post('turmas/:turmaId/perguntas/:id/mensagens')
  responder(
    @ProfessorId() professorId: string,
    @Param('turmaId') turmaId: string,
    @Param('id') id: string,
    @Body() dto: RespostaProfessorDto,
  ) {
    return this.service.responderDoProfessor(professorId, turmaId, id, dto);
  }

  @Post('turmas/:turmaId/perguntas/:id/encerrar')
  encerrar(
    @ProfessorId() professorId: string,
    @Param('turmaId') turmaId: string,
    @Param('id') id: string,
  ) {
    return this.service.encerrarDoProfessor(professorId, turmaId, id);
  }

  @Post('turmas/:turmaId/perguntas/:id/reabrir')
  reabrir(
    @ProfessorId() professorId: string,
    @Param('turmaId') turmaId: string,
    @Param('id') id: string,
  ) {
    return this.service.reabrir(professorId, turmaId, id);
  }
}

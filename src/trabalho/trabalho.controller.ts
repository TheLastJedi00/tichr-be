import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ProfessorId } from '../auth/current-user.decorator';
import {
  AvaliarEntregaDto,
  CriarAtividadeDto,
  EditarAtividadeDto,
} from './dto/trabalho.dto';
import { TrabalhoService } from './trabalho.service';

/** Lado do professor do envio de trabalhos (spec 038). */
@Controller()
export class TrabalhoController {
  constructor(private readonly service: TrabalhoService) {}

  @Get('trabalhos/pendentes')
  pendentes(@ProfessorId() professorId: string) {
    return this.service.pendentesPorTurma(professorId);
  }

  @Get('turmas/:turmaId/atividades')
  listar(
    @ProfessorId() professorId: string,
    @Param('turmaId') turmaId: string,
  ) {
    return this.service.listarAtividades(professorId, turmaId);
  }

  @Post('turmas/:turmaId/atividades')
  criar(
    @ProfessorId() professorId: string,
    @Param('turmaId') turmaId: string,
    @Body() dto: CriarAtividadeDto,
  ) {
    return this.service.criarAtividade(professorId, turmaId, dto);
  }

  @Patch('turmas/:turmaId/atividades/:id')
  editar(
    @ProfessorId() professorId: string,
    @Param('turmaId') turmaId: string,
    @Param('id') id: string,
    @Body() dto: EditarAtividadeDto,
  ) {
    return this.service.editarAtividade(professorId, turmaId, id, dto);
  }

  @Delete('turmas/:turmaId/atividades/:id')
  @HttpCode(204)
  excluir(
    @ProfessorId() professorId: string,
    @Param('turmaId') turmaId: string,
    @Param('id') id: string,
  ) {
    return this.service.excluirAtividade(professorId, turmaId, id);
  }

  @Get('turmas/:turmaId/atividades/:id/entregas')
  entregas(
    @ProfessorId() professorId: string,
    @Param('turmaId') turmaId: string,
    @Param('id') id: string,
  ) {
    return this.service.entregasDaAtividade(professorId, turmaId, id);
  }

  @Get('turmas/:turmaId/atividades/:id/entregas/:alunoId')
  entrega(
    @ProfessorId() professorId: string,
    @Param('turmaId') turmaId: string,
    @Param('id') id: string,
    @Param('alunoId') alunoId: string,
  ) {
    return this.service.entregaDoAluno(professorId, turmaId, id, alunoId);
  }

  @Get('turmas/:turmaId/atividades/:id/entregas/:alunoId/arquivos/:arquivoId')
  arquivo(
    @ProfessorId() professorId: string,
    @Param('turmaId') turmaId: string,
    @Param('id') id: string,
    @Param('alunoId') alunoId: string,
    @Param('arquivoId') arquivoId: string,
  ) {
    return this.service.arquivoDoProfessor(
      professorId,
      turmaId,
      id,
      alunoId,
      arquivoId,
    );
  }

  @Put('turmas/:turmaId/atividades/:id/entregas/:alunoId/avaliacao')
  avaliar(
    @ProfessorId() professorId: string,
    @Param('turmaId') turmaId: string,
    @Param('id') id: string,
    @Param('alunoId') alunoId: string,
    @Body() dto: AvaliarEntregaDto,
  ) {
    return this.service.avaliar(professorId, turmaId, id, alunoId, dto);
  }
}

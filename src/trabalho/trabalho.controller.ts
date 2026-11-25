import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ProfessorId } from '../auth/current-user.decorator';
import { CriarAtividadeDto, EditarAtividadeDto } from './dto/trabalho.dto';
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
}

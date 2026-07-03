import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ProfessorId } from '../auth/current-user.decorator';
import { CreateTopicosDto } from './dto/create-topicos.dto';
import { TopicoService } from './topico.service';

/** Tópicos (backlog) de uma disciplina — microplanejamento (Mestre+). */
@Controller('topicos')
export class TopicoController {
  constructor(private readonly topicoService: TopicoService) {}

  @Get()
  listar(
    @ProfessorId() professorId: string,
    @Query('disciplina') disciplina: string,
  ) {
    return this.topicoService.listar(professorId, disciplina ?? '');
  }

  @Post()
  adicionar(
    @ProfessorId() professorId: string,
    @Body() dto: CreateTopicosDto,
  ) {
    return this.topicoService.adicionar(professorId, dto.disciplina, dto.nomes);
  }

  @Delete(':id')
  remover(@ProfessorId() professorId: string, @Param('id') id: string) {
    return this.topicoService.remover(professorId, id);
  }
}

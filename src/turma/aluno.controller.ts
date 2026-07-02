import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { ProfessorId } from '../auth/current-user.decorator';
import { AlunoService } from './aluno.service';
import { CreateAlunosDto } from './dto/create-alunos.dto';

/** Lista de chamada (alunos) de uma turma. */
@Controller('turmas/:turmaId/alunos')
export class AlunoController {
  constructor(private readonly alunoService: AlunoService) {}

  @Get()
  listar(
    @ProfessorId() professorId: string,
    @Param('turmaId') turmaId: string,
  ) {
    return this.alunoService.listar(professorId, turmaId);
  }

  @Post()
  adicionar(
    @ProfessorId() professorId: string,
    @Param('turmaId') turmaId: string,
    @Body() dto: CreateAlunosDto,
  ) {
    return this.alunoService.adicionar(professorId, turmaId, dto.nomes);
  }

  @Delete(':alunoId')
  remover(
    @ProfessorId() professorId: string,
    @Param('turmaId') turmaId: string,
    @Param('alunoId') alunoId: string,
  ) {
    return this.alunoService.remover(professorId, turmaId, alunoId);
  }
}

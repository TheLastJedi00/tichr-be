import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { ProfessorId } from '../auth/current-user.decorator';
import { CreateExcecaoDto } from './dto/create-excecao.dto';
import { CreateTurmaDto } from './dto/create-turma.dto';
import { UpdateTurmaDto } from './dto/update-turma.dto';
import { TurmaService } from './turma.service';

@Controller()
export class TurmaController {
  constructor(private readonly turmaService: TurmaService) {}

  @Post('turmas')
  criarTurma(
    @ProfessorId() professorId: string,
    @Body() dto: CreateTurmaDto,
  ) {
    return this.turmaService.criarTurma(professorId, dto);
  }

  @Post('excecoes')
  adicionarExcecao(
    @ProfessorId() professorId: string,
    @Body() dto: CreateExcecaoDto,
  ) {
    return this.turmaService.adicionarExcecao(professorId, dto);
  }

  @Get('sessoes')
  listarSessoes(@ProfessorId() professorId: string) {
    return this.turmaService.listarSessoes(professorId);
  }

  @Get('turmas')
  listarTurmas(@ProfessorId() professorId: string) {
    return this.turmaService.listarTurmas(professorId);
  }

  @Get('turmas/:id')
  buscarTurma(@ProfessorId() professorId: string, @Param('id') id: string) {
    return this.turmaService.buscarTurma(professorId, id);
  }

  @Put('turmas/:id')
  atualizarTurma(
    @ProfessorId() professorId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTurmaDto,
  ) {
    return this.turmaService.atualizarTurma(professorId, id, dto);
  }
}

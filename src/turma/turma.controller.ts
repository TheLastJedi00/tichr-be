import { Body, Controller, Get, Post } from '@nestjs/common';
import { ProfessorId } from '../auth/current-user.decorator';
import { CreateExcecaoDto } from './dto/create-excecao.dto';
import { CreateTurmaDto } from './dto/create-turma.dto';
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
}

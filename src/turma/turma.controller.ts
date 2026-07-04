import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ProfessorId } from '../auth/current-user.decorator';
import { AlunoService } from './aluno.service';
import { CreateExcecaoDto } from './dto/create-excecao.dto';
import { CreateTurmaDto } from './dto/create-turma.dto';
import { UpdateTurmaDto } from './dto/update-turma.dto';
import { PlanosGuard } from './planos.guard';
import { TurmaService } from './turma.service';

@Controller()
export class TurmaController {
  constructor(
    private readonly turmaService: TurmaService,
    private readonly alunoService: AlunoService,
  ) {}

  @Post('turmas')
  @UseGuards(PlanosGuard)
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

  /** Migra a turma para os Smart PINs (regenera PIN da sala + PINs dos alunos). */
  @Post('turmas/:id/migrar-pins')
  migrarPins(@ProfessorId() professorId: string, @Param('id') id: string) {
    return this.turmaService.migrarPins(professorId, id);
  }

  /** Encerra a turma (vira somente-leitura e libera o PIN de volta ao pool). */
  @Post('turmas/:id/encerrar')
  encerrar(@ProfessorId() professorId: string, @Param('id') id: string) {
    return this.turmaService.encerrar(professorId, id);
  }

  /** Progresso do curso (aulas concluidas/total) + base coletiva. */
  @Get('turmas/:id/progresso')
  async progresso(
    @ProfessorId() professorId: string,
    @Param('id') id: string,
  ) {
    await this.turmaService.buscarTurma(professorId, id); // valida posse
    return this.alunoService.progresso(id);
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

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ProfessorId } from '../auth/current-user.decorator';
import { AlunoService } from './aluno.service';
import { CreateAlunosDto } from './dto/create-alunos.dto';
import { DefinirEquipeDto } from './dto/definir-equipe.dto';
import { DistribuirXpDto } from './dto/distribuir-xp.dto';
import { RenameAlunoDto } from './dto/rename-aluno.dto';
import { XpService } from './xp.service';

/** Lista de chamada (alunos) de uma turma. */
@Controller('turmas/:turmaId/alunos')
export class AlunoController {
  constructor(
    private readonly alunoService: AlunoService,
    private readonly xpService: XpService,
  ) {}

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

  @Patch(':alunoId')
  renomear(
    @ProfessorId() professorId: string,
    @Param('turmaId') turmaId: string,
    @Param('alunoId') alunoId: string,
    @Body() dto: RenameAlunoDto,
  ) {
    return this.alunoService.renomear(professorId, turmaId, alunoId, dto.nome);
  }

  @Delete(':alunoId')
  remover(
    @ProfessorId() professorId: string,
    @Param('turmaId') turmaId: string,
    @Param('alunoId') alunoId: string,
  ) {
    return this.alunoService.remover(professorId, turmaId, alunoId);
  }

  /** Move o aluno para uma equipe (drop) ou de volta ao pool (equipeId=null). */
  @Patch(':alunoId/equipe')
  definirEquipe(
    @ProfessorId() professorId: string,
    @Param('turmaId') turmaId: string,
    @Param('alunoId') alunoId: string,
    @Body() dto: DefinirEquipeDto,
  ) {
    return this.alunoService.definirEquipe(
      professorId,
      turmaId,
      alunoId,
      dto.equipeId,
    );
  }

  /** Distribui XP a um aluno (ferramenta rapida do professor no Plano PhD). */
  @Post(':alunoId/xp')
  darXp(
    @ProfessorId() professorId: string,
    @Param('turmaId') turmaId: string,
    @Param('alunoId') alunoId: string,
    @Body() dto: DistribuirXpDto,
  ) {
    return this.xpService.distribuir(
      professorId,
      turmaId,
      alunoId,
      dto.pontos,
      dto.motivo,
    );
  }
}

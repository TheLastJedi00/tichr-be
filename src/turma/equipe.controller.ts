import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ProfessorId } from '../auth/current-user.decorator';
import { CreateEquipeDto } from './dto/create-equipe.dto';
import { UpdateEquipeDto } from './dto/update-equipe.dto';
import { EquipeService } from './equipe.service';

/** Equipes persistentes de uma turma (agrupamento manual — Plano Mestre). */
@Controller('turmas/:turmaId/equipes')
export class EquipeController {
  constructor(private readonly equipeService: EquipeService) {}

  @Get()
  listar(
    @ProfessorId() professorId: string,
    @Param('turmaId') turmaId: string,
  ) {
    return this.equipeService.listar(professorId, turmaId);
  }

  @Post()
  criar(
    @ProfessorId() professorId: string,
    @Param('turmaId') turmaId: string,
    @Body() dto: CreateEquipeDto,
  ) {
    return this.equipeService.criar(professorId, turmaId, dto);
  }

  @Put(':equipeId')
  atualizar(
    @ProfessorId() professorId: string,
    @Param('turmaId') turmaId: string,
    @Param('equipeId') equipeId: string,
    @Body() dto: UpdateEquipeDto,
  ) {
    return this.equipeService.atualizar(professorId, turmaId, equipeId, dto);
  }

  @Delete(':equipeId')
  remover(
    @ProfessorId() professorId: string,
    @Param('turmaId') turmaId: string,
    @Param('equipeId') equipeId: string,
  ) {
    return this.equipeService.remover(professorId, turmaId, equipeId);
  }
}

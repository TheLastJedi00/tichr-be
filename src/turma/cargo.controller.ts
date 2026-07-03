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
import { CargoService } from './cargo.service';
import { AtribuirCargoDto } from './dto/atribuir-cargo.dto';
import { CreateCargosDto } from './dto/create-cargos.dto';

/** Cargos (tarefas/papéis) de uma turma e sua atribuição a membros. */
@Controller('turmas/:turmaId/cargos')
export class CargoController {
  constructor(private readonly cargoService: CargoService) {}

  @Get()
  listar(
    @ProfessorId() professorId: string,
    @Param('turmaId') turmaId: string,
  ) {
    return this.cargoService.listar(professorId, turmaId);
  }

  @Post()
  adicionar(
    @ProfessorId() professorId: string,
    @Param('turmaId') turmaId: string,
    @Body() dto: CreateCargosDto,
  ) {
    return this.cargoService.adicionar(professorId, turmaId, dto.nomes);
  }

  @Delete(':cargoId')
  remover(
    @ProfessorId() professorId: string,
    @Param('turmaId') turmaId: string,
    @Param('cargoId') cargoId: string,
  ) {
    return this.cargoService.remover(professorId, turmaId, cargoId);
  }

  /** Define o conjunto de membros responsáveis por um cargo. */
  @Put(':cargoId/membros')
  atribuir(
    @ProfessorId() professorId: string,
    @Param('turmaId') turmaId: string,
    @Param('cargoId') cargoId: string,
    @Body() dto: AtribuirCargoDto,
  ) {
    return this.cargoService.atribuir(
      professorId,
      turmaId,
      cargoId,
      dto.alunoIds,
    );
  }
}

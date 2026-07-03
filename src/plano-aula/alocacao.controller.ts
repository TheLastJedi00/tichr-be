import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Put,
} from '@nestjs/common';
import { ProfessorId } from '../auth/current-user.decorator';
import { DefinirAlocacaoDto } from './dto/definir-alocacao.dto';
import { AlocacaoService } from './alocacao.service';

/** Alocação de tópicos às aulas de uma turma (por número da aula). */
@Controller('turmas/:turmaId/alocacoes')
export class AlocacaoController {
  constructor(private readonly alocacaoService: AlocacaoService) {}

  @Get()
  listar(
    @ProfessorId() professorId: string,
    @Param('turmaId') turmaId: string,
  ) {
    return this.alocacaoService.listar(professorId, turmaId);
  }

  @Put(':numero')
  definir(
    @ProfessorId() professorId: string,
    @Param('turmaId') turmaId: string,
    @Param('numero', ParseIntPipe) numero: number,
    @Body() dto: DefinirAlocacaoDto,
  ) {
    return this.alocacaoService.definir(
      professorId,
      turmaId,
      numero,
      dto.topicoId,
    );
  }
}

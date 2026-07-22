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
import { DefinirAlocacoesRegularesDto } from './dto/definir-alocacoes-regulares.dto';
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

  /** Regrava o board REGULAR (Unidades Eletivas) da turma de uma só vez. */
  @Put('regulares')
  definirRegulares(
    @ProfessorId() professorId: string,
    @Param('turmaId') turmaId: string,
    @Body() dto: DefinirAlocacoesRegularesDto,
  ) {
    return this.alocacaoService.definirRegulares(
      professorId,
      turmaId,
      dto.unidades,
    );
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

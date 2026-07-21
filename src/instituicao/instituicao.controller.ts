import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ProfessorId } from '../auth/current-user.decorator';
import { CreateInstituicaoDto } from './dto/create-instituicao.dto';
import { UpdateInstituicaoDto } from './dto/update-instituicao.dto';
import { InstituicaoService } from './instituicao.service';

/**
 * CRUD das instituicoes (escolas) do ensino regular. Toda rota e escopada ao
 * professor autenticado (AuthGuard global) e devolve a instituicao com a `grade`
 * calculada.
 */
@Controller('instituicoes')
export class InstituicaoController {
  constructor(private readonly service: InstituicaoService) {}

  @Get()
  listar(@ProfessorId() professorId: string) {
    return this.service.listar(professorId);
  }

  @Get(':id')
  buscar(@ProfessorId() professorId: string, @Param('id') id: string) {
    return this.service.buscar(professorId, id);
  }

  @Post()
  criar(
    @ProfessorId() professorId: string,
    @Body() dto: CreateInstituicaoDto,
  ) {
    return this.service.criar(professorId, dto);
  }

  @Put(':id')
  atualizar(
    @ProfessorId() professorId: string,
    @Param('id') id: string,
    @Body() dto: UpdateInstituicaoDto,
  ) {
    return this.service.atualizar(professorId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remover(@ProfessorId() professorId: string, @Param('id') id: string) {
    return this.service.remover(professorId, id);
  }
}

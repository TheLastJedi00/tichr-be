import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ProfessorId } from '../auth/current-user.decorator';
import { DenunciaService } from './denuncia.service';
import {
  CriarTopicoDto,
  EditarTopicoDto,
  ListarDenunciasQuery,
  ValidarDenunciaDto,
} from './dto/denuncia.dto';

/** Lado do professor da denúncia entre alunos (spec 032). */
@Controller()
export class DenunciaController {
  constructor(private readonly service: DenunciaService) {}

  @Get('denuncias/topicos')
  listarTopicos(@ProfessorId() professorId: string) {
    return this.service.listarTopicos(professorId);
  }

  @Post('denuncias/topicos')
  criarTopico(@ProfessorId() professorId: string, @Body() dto: CriarTopicoDto) {
    return this.service.criarTopico(professorId, dto);
  }

  @Patch('denuncias/topicos/:id')
  editarTopico(
    @ProfessorId() professorId: string,
    @Param('id') id: string,
    @Body() dto: EditarTopicoDto,
  ) {
    return this.service.editarTopico(professorId, id, dto);
  }

  @Get('denuncias/pendentes')
  pendentes(@ProfessorId() professorId: string) {
    return this.service.pendentesPorTurma(professorId);
  }

  @Get('turmas/:turmaId/denuncias')
  listar(
    @ProfessorId() professorId: string,
    @Param('turmaId') turmaId: string,
    @Query() query: ListarDenunciasQuery,
  ) {
    return this.service.listarDaTurma(professorId, turmaId, query.status);
  }

  @Get('turmas/:turmaId/denuncias/janelas')
  janelas(
    @ProfessorId() professorId: string,
    @Param('turmaId') turmaId: string,
  ) {
    return this.service.janelas(professorId, turmaId);
  }

  @Post('turmas/:turmaId/denuncias/abrir')
  abrir(@ProfessorId() professorId: string, @Param('turmaId') turmaId: string) {
    return this.service.abrirJanela(professorId, turmaId);
  }

  @Post('turmas/:turmaId/denuncias/fechar')
  fechar(
    @ProfessorId() professorId: string,
    @Param('turmaId') turmaId: string,
  ) {
    return this.service.fecharJanela(professorId, turmaId);
  }

  @Get('turmas/:turmaId/denuncias/:id/imagem')
  imagem(
    @ProfessorId() professorId: string,
    @Param('turmaId') turmaId: string,
    @Param('id') id: string,
  ) {
    return this.service.urlImagem(professorId, turmaId, id);
  }

  @Post('turmas/:turmaId/denuncias/:id/validar')
  validar(
    @ProfessorId() professorId: string,
    @Param('turmaId') turmaId: string,
    @Param('id') id: string,
    @Body() dto: ValidarDenunciaDto,
  ) {
    return this.service.validar(professorId, turmaId, id, dto.pontos);
  }

  @Post('turmas/:turmaId/denuncias/:id/invalidar')
  async invalidar(
    @ProfessorId() professorId: string,
    @Param('turmaId') turmaId: string,
    @Param('id') id: string,
  ) {
    await this.service.invalidar(professorId, turmaId, id);
    return { ok: true };
  }
}

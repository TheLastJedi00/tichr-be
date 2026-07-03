import { Body, Controller, Get, Put } from '@nestjs/common';
import { ProfessorId } from '../auth/current-user.decorator';
import { UpsertPlanoAulaDto } from './dto/upsert-plano-aula.dto';
import { PlanoAulaService } from './plano-aula.service';

/** Plano de Aula — escopo geral (Syllabus) por disciplina. */
@Controller('planos-aula')
export class PlanoAulaController {
  constructor(private readonly planoAulaService: PlanoAulaService) {}

  @Get()
  listar(@ProfessorId() professorId: string) {
    return this.planoAulaService.listar(professorId);
  }

  @Put()
  upsert(@ProfessorId() professorId: string, @Body() dto: UpsertPlanoAulaDto) {
    return this.planoAulaService.upsert(
      professorId,
      dto.disciplina,
      dto.contextoGeral,
    );
  }
}

import { Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentStudent } from '../auth/current-student.decorator';
import { Roles } from '../auth/roles.decorator';
import { PartidaService } from './partida.service';

/** Acesso do aluno ao Tichr Qlick (portal). */
@Controller('aluno/qlick')
@Roles('STUDENT')
export class AlunoQlickController {
  constructor(private readonly partidaService: PartidaService) {}

  /** Qlick "de hoje" (só dentro da janela da aula). */
  @Get()
  atual(@CurrentStudent() { turmaId }: { alunoId: string; turmaId: string }) {
    return this.partidaService.partidaDaTurma(turmaId);
  }

  @Post(':partidaId/inscricao')
  inscrever(
    @CurrentStudent() { alunoId }: { alunoId: string; turmaId: string },
    @Param('partidaId') partidaId: string,
  ) {
    return this.partidaService.inscrever(alunoId, partidaId);
  }
}

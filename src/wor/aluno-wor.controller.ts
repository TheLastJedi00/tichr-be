import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentStudent } from '../auth/current-student.decorator';
import { Roles } from '../auth/roles.decorator';
import { EntrarWorDto } from './dto/entrar-wor.dto';
import { WorMatchService } from './wor-match.service';

/** Acesso do aluno ao Tichr Wor pelo portal (mesma auth do Qlick). */
@Controller('aluno/wor')
@Roles('STUDENT')
export class AlunoWorController {
  constructor(private readonly service: WorMatchService) {}

  /** Partida ativa da turma do aluno (lobby ou em andamento), ou null. */
  @Get()
  atual(@CurrentStudent() { turmaId }: { alunoId: string; turmaId: string }) {
    return this.service.partidaDaTurma(turmaId);
  }

  /** Inscreve o aluno no lobby da partida. */
  @Post(':matchId/entrar')
  entrar(
    @CurrentStudent() { alunoId, turmaId }: { alunoId: string; turmaId: string },
    @Param('matchId') matchId: string,
    @Body() dto: EntrarWorDto,
  ) {
    return this.service.inscrever(alunoId, turmaId, matchId, dto.nome ?? 'Aluno');
  }
}

import { Controller, Get } from '@nestjs/common';
import { CurrentStudent } from '../auth/current-student.decorator';
import { Roles } from '../auth/roles.decorator';
import { AlunoPlanoService } from './aluno-plano.service';

/** Portal do aluno (PhD): tópicos do plano de aula alocados às suas aulas. */
@Controller('aluno/plano')
@Roles('STUDENT')
export class AlunoPlanoController {
  constructor(private readonly alunoPlanoService: AlunoPlanoService) {}

  @Get()
  meuPlano(
    @CurrentStudent() { turmaId }: { alunoId: string; turmaId: string },
  ) {
    return this.alunoPlanoService.topicosDaTurma(turmaId);
  }
}

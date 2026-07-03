import { Controller, Get } from '@nestjs/common';
import { CurrentStudent } from '../auth/current-student.decorator';
import { Roles } from '../auth/roles.decorator';
import { AlunoService } from './aluno.service';

/**
 * Portal do aluno (Plano PhD): endpoints somente-leitura acessiveis com o JWT
 * de aluno. O aluno so enxerga a propria turma e o proprio perfil.
 */
@Controller('aluno')
@Roles('STUDENT')
export class AlunoPortalController {
  constructor(private readonly alunoService: AlunoService) {}

  @Get('me')
  meuPerfil(@CurrentStudent() { alunoId }: { alunoId: string; turmaId: string }) {
    return this.alunoService.perfil(alunoId);
  }

  @Get('agenda')
  minhaAgenda(
    @CurrentStudent() { turmaId }: { alunoId: string; turmaId: string },
  ) {
    return this.alunoService.agenda(turmaId);
  }

  @Get('progresso')
  meuProgresso(
    @CurrentStudent() { turmaId }: { alunoId: string; turmaId: string },
  ) {
    return this.alunoService.progresso(turmaId);
  }
}

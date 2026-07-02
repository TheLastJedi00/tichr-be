import { Body, Controller, Param, Post } from '@nestjs/common';
import { ProfessorId } from '../auth/current-user.decorator';
import { AgrupamentoService, Squad } from './agrupamento.service';
import { AlunoService } from './aluno.service';
import { CreateAgrupamentoDto } from './dto/create-agrupamento.dto';

/** Sorteio de squads a partir da lista de chamada da turma. */
@Controller('turmas/:turmaId/agrupamento')
export class AgrupamentoController {
  constructor(
    private readonly alunoService: AlunoService,
    private readonly agrupamentoService: AgrupamentoService,
  ) {}

  @Post()
  async sortear(
    @ProfessorId() professorId: string,
    @Param('turmaId') turmaId: string,
    @Body() dto: CreateAgrupamentoDto,
  ): Promise<{ squads: Squad[] }> {
    // listar ja valida a posse da turma pelo professor.
    const alunos = await this.alunoService.listar(professorId, turmaId);
    const squads = this.agrupamentoService.sortear(
      alunos,
      dto.numeroEquipes,
      dto.papeis ?? [],
      dto.temas ?? [],
    );
    return { squads };
  }
}

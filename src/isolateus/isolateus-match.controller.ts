import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ProfessorId } from '../auth/current-user.decorator';
import { CriarPartidaIsolateusDto } from './dto/responder-isolateus.dto';
import { IsolateusMatchService } from './isolateus-match.service';

/** Comando Central: o professor conduz a investigação a partir do telão. */
@Controller('isolateus')
export class IsolateusMatchController {
  constructor(private readonly matches: IsolateusMatchService) {}

  @Post('jogos/:jogoId/partida')
  criar(
    @ProfessorId() professorId: string,
    @Param('jogoId') jogoId: string,
    @Body() dto: CriarPartidaIsolateusDto,
  ) {
    return this.matches.criar(professorId, jogoId, dto.turmaId);
  }

  @Get('matches/:id')
  ver(@ProfessorId() professorId: string, @Param('id') id: string) {
    return this.matches.obterDoProfessor(professorId, id);
  }

  /** A auditoria dos pseudônimos: veta um nome e devolve o aluno ao registro. */
  @Post('matches/:id/vetar/:alunoId')
  vetar(
    @ProfessorId() professorId: string,
    @Param('id') id: string,
    @Param('alunoId') alunoId: string,
  ) {
    return this.matches.vetarNome(professorId, id, alunoId);
  }

  /** O Despertar: preenche a vila com NPCs e sorteia a Ameaça. */
  @Post('matches/:id/iniciar')
  iniciar(@ProfessorId() professorId: string, @Param('id') id: string) {
    return this.matches.iniciar(professorId, id);
  }
}

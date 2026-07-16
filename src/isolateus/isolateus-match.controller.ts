import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ProfessorId } from '../auth/current-user.decorator';
import { CriarPartidaIsolateusDto } from './dto/responder-isolateus.dto';
import { RenomearIsolateusDto } from './dto/renomear-isolateus.dto';
import { IsolateusGameService } from './isolateus-game.service';
import { IsolateusMatchService } from './isolateus-match.service';

/** Comando Central: o professor conduz a investigação a partir do telão. */
@Controller('isolateus')
export class IsolateusMatchController {
  constructor(
    private readonly matches: IsolateusMatchService,
    private readonly game: IsolateusGameService,
  ) {}

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

  /** Corrige o pseudônimo de um habitante sem tirá-lo do lobby (só no LOBBY). */
  @Post('matches/:id/renomear/:alunoId')
  renomear(
    @ProfessorId() professorId: string,
    @Param('id') id: string,
    @Param('alunoId') alunoId: string,
    @Body() dto: RenomearIsolateusDto,
  ) {
    return this.matches.renomearInscrito(professorId, id, alunoId, dto.pseudonimo);
  }

  /** O Despertar: preenche a vila com NPCs e sorteia a Ameaça. */
  @Post('matches/:id/iniciar')
  iniciar(@ProfessorId() professorId: string, @Param('id') id: string) {
    return this.matches.iniciar(professorId, id);
  }

  /**
   * O projetor dispara ao zerar o cronômetro. Não há timer no servidor: ele só
   * revalida o prazo e resolve a rodada (padrão do Wor).
   */
  @Post('matches/:id/tempo')
  tempo(@ProfessorId() professorId: string, @Param('id') id: string) {
    return this.game.resolverPorTempo(professorId, id);
  }

  /** A próxima noite. */
  @Post('matches/:id/proxima')
  proxima(@ProfessorId() professorId: string, @Param('id') id: string) {
    return this.game.proxima(professorId, id);
  }

  /** O professor também pode abrir a Quarentena pelo telão. */
  @Post('matches/:id/quarentena')
  quarentena(@ProfessorId() professorId: string, @Param('id') id: string) {
    return this.game.convocarQuarentena(id, { professorId });
  }
}

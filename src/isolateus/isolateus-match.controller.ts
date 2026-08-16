import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ProfessorId } from '../auth/current-user.decorator';
import { CriarPartidaIsolateusDto } from './dto/responder-isolateus.dto';
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

  /** Remove um habitante do lobby (entrou na partida errada). Só no LOBBY. */
  @Post('matches/:id/remover/:alunoId')
  remover(
    @ProfessorId() professorId: string,
    @Param('id') id: string,
    @Param('alunoId') alunoId: string,
  ) {
    return this.matches.removerInscrito(professorId, id, alunoId);
  }

  /** O Despertar: preenche a vila com NPCs e sorteia a Ameaça. */
  @Post('matches/:id/iniciar')
  iniciar(@ProfessorId() professorId: string, @Param('id') id: string) {
    return this.matches.iniciar(professorId, id);
  }

  /**
   * O projetor dispara ao zerar o cronômetro. Não há timer no servidor: ele só
   * revalida o prazo e resolve a rodada (padrão do Wor). Os celulares da turma
   * cobram o mesmo prazo pela rota do aluno — o avanço não depende de uma aba só.
   */
  @Post('matches/:id/tempo')
  tempo(@ProfessorId() professorId: string, @Param('id') id: string) {
    return this.game.resolverPorTempo(id, { professorId });
  }

  /** A próxima noite. */
  @Post('matches/:id/proxima')
  proxima(@ProfessorId() professorId: string, @Param('id') id: string) {
    return this.game.proxima(professorId, id);
  }

  /**
   * Encerra a investigação no meio do jogo (o sinal da aula bateu). O veredito
   * sai pelo estado da vila no instante da interrupção.
   */
  @Post('matches/:id/encerrar')
  encerrar(@ProfessorId() professorId: string, @Param('id') id: string) {
    return this.game.encerrarPeloProfessor(professorId, id);
  }
}

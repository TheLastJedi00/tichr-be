import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentStudent } from '../auth/current-student.decorator';
import { Roles } from '../auth/roles.decorator';
import { AcaoAmeacaDto } from './dto/acao-ameaca.dto';
import { EntrarIsolateusDto } from './dto/entrar-isolateus.dto';
import { IsolateusGameService } from './isolateus-game.service';
import { IsolateusMatchService } from './isolateus-match.service';

/** O celular do habitante. Tudo aqui é autenticado como aluno da turma. */
@Controller('aluno/isolateus')
@Roles('STUDENT')
export class AlunoIsolateusController {
  constructor(
    private readonly matches: IsolateusMatchService,
    private readonly game: IsolateusGameService,
  ) {}

  /** A investigação ativa da turma do aluno (ou null). */
  @Get()
  atual(@CurrentStudent() aluno: { turmaId: string }) {
    return this.matches.partidaDaTurma(aluno.turmaId);
  }

  /** O Registro: entra na vila sob um pseudônimo. */
  @Post(':id/entrar')
  entrar(
    @CurrentStudent() aluno: { alunoId: string; turmaId: string },
    @Param('id') id: string,
    @Body() dto: EntrarIsolateusDto,
  ) {
    return this.matches.entrar(
      aluno.alunoId,
      aluno.turmaId,
      id,
      dto.pseudonimo,
    );
  }

  /**
   * A Revelação: o papel do aluno e, só para a Ameaça, a solução verdadeira e os
   * disfarces. É a única porta por onde o segredo sai do servidor — por isso vive
   * numa rota autenticada, e não no documento que o cliente escuta.
   */
  @Get(':id/painel')
  painel(
    @CurrentStudent() aluno: { alunoId: string },
    @Param('id') id: string,
  ) {
    return this.game.painel(aluno.alunoId, id);
  }

  /** O Turno da Ameaça: sabotar um setor ou abduzir um morador. */
  @Post(':id/acao')
  acao(
    @CurrentStudent() aluno: { alunoId: string },
    @Param('id') id: string,
    @Body() dto: AcaoAmeacaDto,
  ) {
    return this.game.acaoAmeaca(aluno.alunoId, id, dto);
  }
}

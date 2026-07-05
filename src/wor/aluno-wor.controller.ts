import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentStudent } from '../auth/current-student.decorator';
import { Roles } from '../auth/roles.decorator';
import { ArriscarDto } from './dto/arriscar.dto';
import { ChutarLetraDto } from './dto/chutar-letra.dto';
import { DilemaDto } from './dto/dilema.dto';
import { EntrarWorDto } from './dto/entrar-wor.dto';
import { WorGameService } from './wor-game.service';
import { WorMatchService } from './wor-match.service';

type Student = { alunoId: string; turmaId: string };

/** Acesso e ações do aluno no Tichr Wor pelo portal (mesma auth do Qlick). */
@Controller('aluno/wor')
@Roles('STUDENT')
export class AlunoWorController {
  constructor(
    private readonly service: WorMatchService,
    private readonly game: WorGameService,
  ) {}

  /** Partida ativa da turma do aluno (lobby ou em andamento), ou null. */
  @Get()
  atual(@CurrentStudent() { turmaId }: Student) {
    return this.service.partidaDaTurma(turmaId);
  }

  /** Inscreve o aluno no lobby da partida. */
  @Post(':matchId/entrar')
  entrar(
    @CurrentStudent() { alunoId, turmaId }: Student,
    @Param('matchId') matchId: string,
    @Body() dto: EntrarWorDto,
  ) {
    return this.service.inscrever(alunoId, turmaId, matchId, dto.nome ?? 'Aluno');
  }

  /** Chuta uma letra no turno da equipe. */
  @Post(':matchId/letra')
  letra(
    @CurrentStudent() { alunoId }: Student,
    @Param('matchId') matchId: string,
    @Body() dto: ChutarLetraDto,
  ) {
    return this.game.chutarLetra(alunoId, matchId, dto.letra);
  }

  /** Resolve o Dilema Tático (Atacar rival / Comprar Dica). */
  @Post(':matchId/dilema')
  dilema(
    @CurrentStudent() { alunoId }: Student,
    @Param('matchId') matchId: string,
    @Body() dto: DilemaDto,
  ) {
    return this.game.resolverDilema(alunoId, matchId, dto.acao, dto.alvoEquipeId);
  }

  /** Risco Heroico / Invasão: tenta a palavra inteira. */
  @Post(':matchId/arriscar')
  arriscar(
    @CurrentStudent() { alunoId }: Student,
    @Param('matchId') matchId: string,
    @Body() dto: ArriscarDto,
  ) {
    return this.game.arriscar(alunoId, matchId, dto.palavra);
  }
}

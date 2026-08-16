import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentStudent } from '../auth/current-student.decorator';
import { Roles } from '../auth/roles.decorator';
import { AcaoAmeacaDto } from './dto/acao-ameaca.dto';
import { MoverDto } from './dto/mover.dto';
import {
  ForjarRumorDto,
  MensagemDto,
  ResponderIsolateusDto,
  VotarSuspeitoDto,
} from './dto/responder-isolateus.dto';
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

  /** O Registro: declara presença. O codinome vem no Despertar. */
  @Post(':id/entrar')
  entrar(
    @CurrentStudent() aluno: { alunoId: string; turmaId: string },
    @Param('id') id: string,
  ) {
    return this.matches.entrar(aluno.alunoId, aluno.turmaId, id);
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

  /** O deslocamento da noite: anda um setor pelas estradas do mapa. */
  @Post(':id/mover')
  mover(
    @CurrentStudent() aluno: { alunoId: string },
    @Param('id') id: string,
    @Body() dto: MoverDto,
  ) {
    return this.game.mover(aluno.alunoId, id, dto.setorId);
  }

  /** "Eu fico." Fecha a jogada da noite sem sair do lugar. */
  @Post(':id/confirmar-posicao')
  confirmarPosicao(
    @CurrentStudent() aluno: { alunoId: string },
    @Param('id') id: string,
  ) {
    return this.game.confirmarPosicao(aluno.alunoId, id);
  }

  /** A Reconstrucao: organiza o reparo do setor em ruinas onde voce esta. */
  @Post(':id/reparo')
  reparo(
    @CurrentStudent() aluno: { alunoId: string },
    @Param('id') id: string,
  ) {
    return this.game.declararReparo(aluno.alunoId, id);
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

  /** A Defesa: o voto na solução do problema. */
  @Post(':id/resposta')
  responder(
    @CurrentStudent() aluno: { alunoId: string },
    @Param('id') id: string,
    @Body() dto: ResponderIsolateusDto,
  ) {
    return this.game.responder(aluno.alunoId, id, dto.alternativaIndex);
  }

  /** A Sabotagem de Frequência: o rumor falso da Ameaça, sob o nome de um NPC. */
  @Post(':id/rumor')
  forjar(
    @CurrentStudent() aluno: { alunoId: string },
    @Param('id') id: string,
    @Body() dto: ForjarRumorDto,
  ) {
    return this.game.forjarRumor(aluno.alunoId, id, dto.texto);
  }

  /** O Sinal Interceptado: a dica anônima de quem já foi levado. */
  @Post(':id/sinal')
  sinal(
    @CurrentStudent() aluno: { alunoId: string },
    @Param('id') id: string,
    @Body() dto: MensagemDto,
  ) {
    return this.game.sinalDeRadio(aluno.alunoId, id, dto.texto);
  }

  /** O botão vermelho: convoca a Quarentena (uma vez por rodada). */
  @Post(':id/quarentena')
  convocar(
    @CurrentStudent() aluno: { alunoId: string },
    @Param('id') id: string,
  ) {
    return this.game.convocarQuarentena(id, { alunoId: aluno.alunoId });
  }

  /** O Debate Tático da Quarentena. */
  @Post(':id/debate')
  debater(
    @CurrentStudent() aluno: { alunoId: string },
    @Param('id') id: string,
    @Body() dto: MensagemDto,
  ) {
    return this.game.debater(aluno.alunoId, id, dto.texto);
  }

  /** Abre mão do debate. Todos pulando, a votação abre na hora. */
  @Post(':id/pular-debate')
  pularDebate(
    @CurrentStudent() aluno: { alunoId: string },
    @Param('id') id: string,
  ) {
    return this.game.pularDebate(aluno.alunoId, id);
  }

  /** O voto no suspeito. */
  @Post(':id/suspeito')
  votar(
    @CurrentStudent() aluno: { alunoId: string },
    @Param('id') id: string,
    @Body() dto: VotarSuspeitoDto,
  ) {
    return this.game.votarSuspeito(aluno.alunoId, id, dto.suspeitoId);
  }
}

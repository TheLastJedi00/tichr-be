import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentStudent } from '../auth/current-student.decorator';
import { Roles } from '../auth/roles.decorator';
import { CriarPerguntaDto, MensagemPerguntaDto } from './dto/pergunta.dto';
import { PerguntaService } from './pergunta.service';

type Aluno = { alunoId: string; turmaId: string };

/** Lado do aluno (portal por PIN) das perguntas ao professor (spec 037). */
@Controller('aluno/perguntas')
@Roles('STUDENT')
export class AlunoPerguntaController {
  constructor(private readonly service: PerguntaService) {}

  @Get('estado')
  estado(@CurrentStudent() aluno: Aluno) {
    return this.service.estadoAluno(aluno);
  }

  @Get()
  minhas(@CurrentStudent() aluno: Aluno) {
    return this.service.minhasDoAluno(aluno);
  }

  @Get(':id')
  detalhe(@CurrentStudent() aluno: Aluno, @Param('id') id: string) {
    return this.service.detalheDoAluno(aluno, id);
  }

  @Post()
  criar(@CurrentStudent() aluno: Aluno, @Body() dto: CriarPerguntaDto) {
    return this.service.criarDoAluno(aluno, dto);
  }

  @Post(':id/mensagens')
  responder(
    @CurrentStudent() aluno: Aluno,
    @Param('id') id: string,
    @Body() dto: MensagemPerguntaDto,
  ) {
    return this.service.responderDoAluno(aluno, id, dto);
  }

  @Post(':id/encerrar')
  encerrar(@CurrentStudent() aluno: Aluno, @Param('id') id: string) {
    return this.service.encerrarDoAluno(aluno, id);
  }
}

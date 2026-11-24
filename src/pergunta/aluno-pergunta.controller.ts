import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentStudent } from '../auth/current-student.decorator';
import { Roles } from '../auth/roles.decorator';
import { CriarPerguntaDto, MensagemPerguntaDto } from './dto/pergunta.dto';
import { PERGUNTA } from './pergunta.constants';
import { ArquivoEnviado, PerguntaService } from './pergunta.service';

type Aluno = { alunoId: string; turmaId: string };
type Multer = { originalname: string; buffer: Buffer };

/**
 * O teto do multer fica folgado (o dobro): quem decide o limite de 4 MB é o
 * `validarAnexo`, que responde com o código ARQUIVO_GRANDE.
 */
const ARQUIVO = FileInterceptor('arquivo', {
  limits: { fileSize: PERGUNTA.ARQUIVO_MAX_BYTES * 2, files: 1 },
});

/** O multer lê o nome do arquivo como latin1: "relatório.pdf" chegaria quebrado. */
function utf8(arquivo?: Multer): ArquivoEnviado | undefined {
  if (!arquivo) return undefined;
  return {
    originalname: Buffer.from(arquivo.originalname, 'latin1').toString('utf8'),
    buffer: arquivo.buffer,
  };
}

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

  @Get(':id/mensagens/:mensagemId/anexo')
  anexo(
    @CurrentStudent() aluno: Aluno,
    @Param('id') id: string,
    @Param('mensagemId') mensagemId: string,
  ) {
    return this.service.anexoDoAluno(aluno, id, mensagemId);
  }

  @Post()
  @UseInterceptors(ARQUIVO)
  criar(
    @CurrentStudent() aluno: Aluno,
    @Body() dto: CriarPerguntaDto,
    @UploadedFile() arquivo?: Multer,
  ) {
    return this.service.criarDoAluno(aluno, dto, utf8(arquivo));
  }

  @Post(':id/mensagens')
  @UseInterceptors(ARQUIVO)
  responder(
    @CurrentStudent() aluno: Aluno,
    @Param('id') id: string,
    @Body() dto: MensagemPerguntaDto,
    @UploadedFile() arquivo?: Multer,
  ) {
    return this.service.responderDoAluno(aluno, id, dto, utf8(arquivo));
  }

  @Post(':id/encerrar')
  encerrar(@CurrentStudent() aluno: Aluno, @Param('id') id: string) {
    return this.service.encerrarDoAluno(aluno, id);
  }
}

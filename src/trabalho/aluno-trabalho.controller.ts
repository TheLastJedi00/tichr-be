import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentStudent } from '../auth/current-student.decorator';
import { Roles } from '../auth/roles.decorator';
import { ANEXO } from '../common/anexo';
import { TextoEntregaDto } from './dto/trabalho.dto';
import { ArquivoEnviado, TrabalhoService } from './trabalho.service';

type Aluno = { alunoId: string; turmaId: string };
type Multer = { originalname: string; buffer: Buffer };

/**
 * Um arquivo por requisição (038 #9). O teto do multer fica folgado (o
 * dobro): quem decide os 4 MB é o `validarAnexo`, com o código ARQUIVO_GRANDE.
 */
const ARQUIVO = FileInterceptor('arquivo', {
  limits: { fileSize: ANEXO.ARQUIVO_MAX_BYTES * 2, files: 1 },
});

/** O multer lê o nome do arquivo como latin1: "relatório.pdf" chegaria quebrado. */
function utf8(arquivo?: Multer): ArquivoEnviado | undefined {
  if (!arquivo) return undefined;
  return {
    originalname: Buffer.from(arquivo.originalname, 'latin1').toString('utf8'),
    buffer: arquivo.buffer,
  };
}

/** Lado do aluno (portal por PIN) do envio de trabalhos (spec 038). */
@Controller('aluno/trabalhos')
@Roles('STUDENT')
export class AlunoTrabalhoController {
  constructor(private readonly service: TrabalhoService) {}

  @Get()
  listar(@CurrentStudent() aluno: Aluno) {
    return this.service.listarDoAluno(aluno);
  }

  @Get(':atividadeId')
  detalhe(
    @CurrentStudent() aluno: Aluno,
    @Param('atividadeId') atividadeId: string,
  ) {
    return this.service.detalheDoAluno(aluno, atividadeId);
  }

  @Put(':atividadeId/texto')
  texto(
    @CurrentStudent() aluno: Aluno,
    @Param('atividadeId') atividadeId: string,
    @Body() dto: TextoEntregaDto,
  ) {
    return this.service.salvarTexto(aluno, atividadeId, dto.texto);
  }

  @Post(':atividadeId/arquivos')
  @UseInterceptors(ARQUIVO)
  enviarArquivo(
    @CurrentStudent() aluno: Aluno,
    @Param('atividadeId') atividadeId: string,
    @UploadedFile() arquivo?: Multer,
  ) {
    return this.service.enviarArquivo(aluno, atividadeId, utf8(arquivo));
  }

  @Delete(':atividadeId/arquivos/:arquivoId')
  removerArquivo(
    @CurrentStudent() aluno: Aluno,
    @Param('atividadeId') atividadeId: string,
    @Param('arquivoId') arquivoId: string,
  ) {
    return this.service.removerArquivo(aluno, atividadeId, arquivoId);
  }

  @Get(':atividadeId/arquivos/:arquivoId')
  arquivo(
    @CurrentStudent() aluno: Aluno,
    @Param('atividadeId') atividadeId: string,
    @Param('arquivoId') arquivoId: string,
  ) {
    return this.service.arquivoDoAluno(aluno, atividadeId, arquivoId);
  }
}

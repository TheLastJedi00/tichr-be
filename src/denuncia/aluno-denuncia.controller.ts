import {
  Body,
  Controller,
  Get,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentStudent } from '../auth/current-student.decorator';
import { Roles } from '../auth/roles.decorator';
import { DENUNCIA } from './denuncia.constants';
import { DenunciaService } from './denuncia.service';
import { CriarDenunciaDto } from './dto/denuncia.dto';

type Aluno = { alunoId: string; turmaId: string };

/** Lado do aluno (portal por PIN) da denúncia entre alunos (spec 032). */
@Controller('aluno/denuncias')
@Roles('STUDENT')
export class AlunoDenunciaController {
  constructor(private readonly service: DenunciaService) {}

  @Get('opcoes')
  opcoes(@CurrentStudent() aluno: Aluno) {
    return this.service.opcoesAluno(aluno);
  }

  @Get()
  minhas(@CurrentStudent() aluno: Aluno) {
    return this.service.minhasDoAluno(aluno);
  }

  /** A foto saiu (033): o arquivo `imagem` ainda é lido só para ser recusado. */
  @Post()
  @UseInterceptors(
    FileInterceptor('imagem', {
      limits: { fileSize: DENUNCIA.IMAGEM_MAX_BYTES },
    }),
  )
  criar(
    @CurrentStudent() aluno: Aluno,
    @Body() dto: CriarDenunciaDto,
    @UploadedFile() imagem?: { buffer: Buffer; mimetype: string; size: number },
  ) {
    return this.service.criarDoAluno(aluno, dto, imagem);
  }
}

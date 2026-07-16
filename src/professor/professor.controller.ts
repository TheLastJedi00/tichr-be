import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AdminService } from '../admin/admin.service';
import { ProfessorId } from '../auth/current-user.decorator';
import { SemVerificacao } from '../auth/sem-verificacao.decorator';
import { ExcluirContaDto } from './dto/excluir-conta.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ProfessorService, ProfessorView } from './professor.service';

/** Multer em memoria: o buffer vai direto ao Storage, sem tocar o disco. */
const AVATAR_UPLOAD_LIMIT = 400 * 1024;

@Controller('profile')
export class ProfessorController {
  constructor(
    private readonly professorService: ProfessorService,
    private readonly adminService: AdminService,
  ) {}

  /** `@SemVerificacao`: a tela de espera mostra o nome do professor. */
  @SemVerificacao()
  @Get()
  getProfile(@ProfessorId() uid: string): Promise<ProfessorView> {
    return this.professorService.getProfileView(uid);
  }

  /** Disponibilidade do @username (debounce da tela de Configuracoes). */
  @Get('check-username')
  checkUsername(@ProfessorId() uid: string, @Query('u') u: string) {
    return this.professorService.checkUsername(uid, u ?? '');
  }

  @Put()
  async updateProfile(
    @ProfessorId() uid: string,
    @Body() dto: UpdateProfileDto,
  ): Promise<ProfessorView> {
    return ProfessorService.montarView(
      await this.professorService.updateProfile(uid, dto),
    );
  }

  /**
   * Foto de perfil (multipart, campo `foto`). O upload é server-side: o cliente
   * não tem sessão do Firebase Auth, então o Storage nega escrita anônima — quem
   * grava é o backend, via Admin SDK. Devolve o perfil já com o `avatarUrl` novo.
   */
  @Post('avatar')
  @UseInterceptors(
    FileInterceptor('foto', { limits: { fileSize: AVATAR_UPLOAD_LIMIT } }),
  )
  uploadAvatar(
    @ProfessorId() uid: string,
    @UploadedFile()
    foto?: { buffer: Buffer; mimetype: string; size: number },
  ): Promise<ProfessorView> {
    return this.professorService.uploadAvatar(uid, foto);
  }

  /**
   * Auto-exclusão da conta (direito LGPD). Exige a senha para reautenticação e
   * faz o hard delete em cascata (turmas/alunos/jogos + login). Irreversível.
   *
   * `@SemVerificacao`: quem não confirmou o e-mail continua podendo apagar a
   * conta — ninguém pode ficar preso numa conta que não consegue nem excluir.
   */
  @SemVerificacao()
  @Delete()
  excluirConta(@ProfessorId() uid: string, @Body() dto: ExcluirContaDto) {
    return this.adminService.excluirPropriaConta(uid, dto.senha);
  }
}

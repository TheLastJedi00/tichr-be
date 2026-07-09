import { Body, Controller, Delete, Get, Put, Query } from '@nestjs/common';
import { AdminService } from '../admin/admin.service';
import { ProfessorId } from '../auth/current-user.decorator';
import { ExcluirContaDto } from './dto/excluir-conta.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ProfessorService, ProfessorView } from './professor.service';

@Controller('profile')
export class ProfessorController {
  constructor(
    private readonly professorService: ProfessorService,
    private readonly adminService: AdminService,
  ) {}

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
   * Auto-exclusão da conta (direito LGPD). Exige a senha para reautenticação e
   * faz o hard delete em cascata (turmas/alunos/jogos + login). Irreversível.
   */
  @Delete()
  excluirConta(@ProfessorId() uid: string, @Body() dto: ExcluirContaDto) {
    return this.adminService.excluirPropriaConta(uid, dto.senha);
  }
}

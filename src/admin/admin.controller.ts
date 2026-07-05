import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { AdminService } from './admin.service';
import { AlterarPlanoDto } from './dto/alterar-plano.dto';
import { DefinirAdminDto } from './dto/definir-admin.dto';

/**
 * Backoffice (SaaS Manager). Todo o controller exige a flag `admin`
 * (via AdminGuard, apos o AuthGuard global resolver o principal).
 */
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  /** Sonda leve: 200 confirma que o usuario e admin (o front usa no guard). */
  @Get('ping')
  ping(): { admin: boolean } {
    return { admin: true };
  }

  /** Visao geral: total, ativos, distribuicao por plano. */
  @Get('metrics')
  metrics() {
    return this.admin.metrics();
  }

  /** CRM: lista/pesquisa professores com uso agregado. */
  @Get('usuarios')
  usuarios(@Query('busca') busca?: string) {
    return this.admin.listarUsuarios(busca);
  }

  @Get('usuarios/:uid')
  detalhe(@Param('uid') uid: string) {
    return this.admin.detalheUsuario(uid);
  }

  /** Suporte: dispara e-mail de redefinicao de senha. */
  @Post('usuarios/:uid/reset-senha')
  resetSenha(@Param('uid') uid: string) {
    return this.admin.resetSenha(uid);
  }

  /** Dados: apaga turmas/alunos/qlicks, mantem o login. */
  @Post('usuarios/:uid/limpar-dados')
  limparDados(@Param('uid') uid: string) {
    return this.admin.limparDados(uid);
  }

  /** Exclusao: `?hard=true` remove dados + login; senao soft-delete. */
  @Delete('usuarios/:uid')
  excluir(@Param('uid') uid: string, @Query('hard') hard?: string) {
    return this.admin.excluirUsuario(uid, hard === 'true');
  }

  /** Override manual de plano (sem cobranca). */
  @Patch('usuarios/:uid/plano')
  alterarPlano(@Param('uid') uid: string, @Body() dto: AlterarPlanoDto) {
    return this.admin.alterarPlano(uid, dto.plano);
  }

  /** Concede/revoga admin (custom claim). */
  @Post('usuarios/:uid/admin')
  definirAdmin(@Param('uid') uid: string, @Body() dto: DefinirAdminDto) {
    return this.admin.definirAdmin(uid, dto.conceder);
  }
}

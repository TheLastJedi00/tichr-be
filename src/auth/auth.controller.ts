import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
// `import type`: exigido pelo isolatedModules + emitDecoratorMetadata quando o
// tipo aparece na assinatura de um parametro decorado (@Res).
import type { Response } from 'express';
import { AuthService, semRefresh, SessaoPublica } from './auth.service';
import { LoginAlunoDto } from './dto/login-aluno.dto';
import { LoginDto } from './dto/login.dto';
import { SignupDto } from './dto/signup.dto';
import { gravarCookieRefresh, limparCookieRefresh } from './sessao.cookie';
import { Public } from './public.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessaoPublica> {
    const sessao = await this.authService.login(dto.email, dto.password);
    gravarCookieRefresh(res, sessao.refreshToken);
    return semRefresh(sessao);
  }

  /** Cadastro (plano Estagiario): cria a conta com nome + aceite legal e devolve o token. */
  @Public()
  @Post('signup')
  async signup(
    @Body() dto: SignupDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessaoPublica> {
    const sessao = await this.authService.signup(
      dto.email,
      dto.password,
      dto.nome,
      dto.aceiteTermos,
      dto.aceitePrivacidade,
    );
    gravarCookieRefresh(res, sessao.refreshToken);
    return semRefresh(sessao);
  }

  /**
   * Encerra a sessao apagando o cookie. Precisa existir no servidor: o cookie e
   * HttpOnly, entao o front nao consegue apaga-lo sozinho. `@Public()` porque
   * sair deve funcionar mesmo com o ID token ja expirado.
   */
  @Public()
  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response): { ok: true } {
    limparCookieRefresh(res);
    return { ok: true };
  }

  /** Login do aluno via portal: turmaId + PIN -> JWT customizado. */
  @Public()
  @Post('aluno')
  loginAluno(@Body() dto: LoginAlunoDto) {
    return this.authService.loginAluno(dto.turmaId, dto.pin);
  }

  /** Info publica da turma (nome + nomes dos alunos) para a tela de login. */
  @Public()
  @Get('turma/:turmaId')
  infoTurma(@Param('turmaId') turmaId: string) {
    return this.authService.infoTurmaLogin(turmaId);
  }
}

import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
// `import type`: exigido pelo isolatedModules + emitDecoratorMetadata quando o
// tipo aparece na assinatura de um parametro decorado (@Res/@Req).
import type { Request, Response } from 'express';
import {
  AuthService,
  ContaAuth,
  semRefresh,
  SessaoPublica,
} from './auth.service';
import { LoginAlunoDto } from './dto/login-aluno.dto';
import { LoginDto } from './dto/login.dto';
import { RecuperarSenhaDto } from './dto/recuperar-senha.dto';
import { SignupDto } from './dto/signup.dto';
import { TrocarEmailDto } from './dto/trocar-email.dto';
import {
  COOKIE_REFRESH,
  gravarCookieRefresh,
  limparCookieRefresh,
} from './sessao.cookie';
import { ProfessorId } from './current-user.decorator';
import { Public } from './public.decorator';
import { SemVerificacao } from './sem-verificacao.decorator';

/**
 * O ID token cru, para os fluxos do Identity Toolkit que o exigem no corpo
 * (VERIFY_EMAIL, VERIFY_AND_CHANGE_EMAIL). O `@ProfessorId()` so entrega o uid,
 * e o guard ja validou o header quando chegamos aqui.
 */
function extrairIdToken(req: Request): string {
  const [tipo, token] = req.headers.authorization?.split(' ') ?? [];
  return tipo === 'Bearer' ? token : '';
}

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
   * Renova a sessao a partir do cookie. `@Public()` por definicao: o ID token do
   * chamador ja expirou, e a credencial aqui e o cookie, nao o header. Sem DTO —
   * o refresh nao trafega em corpo nenhum.
   */
  @Public()
  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessaoPublica> {
    const atual = (req.cookies as Record<string, string> | undefined)?.[
      COOKIE_REFRESH
    ];
    const sessao = await this.authService.refresh(atual ?? '');
    // A Secure Token API pode rotacionar o refresh; se rotacionou, o cookie
    // precisa acompanhar, senao a proxima renovacao usa um token morto.
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

  /**
   * "Esqueci minha senha". `@Public()` — quem esqueceu a senha nao esta logado.
   * Responde sempre 200 { enviado: true }, mesmo para e-mail inexistente: a
   * resposta nao pode revelar quem tem conta no Tichr.
   */
  @Public()
  @Post('recuperar-senha')
  recuperarSenha(@Body() dto: RecuperarSenhaDto): Promise<{ enviado: true }> {
    return this.authService.recuperarSenha(dto.email);
  }

  /**
   * Status da confirmacao, lido ao vivo no Firebase Auth. A tela de espera faz
   * poll aqui — o claim do token nao serve, fica congelado na emissao.
   */
  @SemVerificacao()
  @Get('verificacao')
  statusVerificacao(
    @ProfessorId() uid: string,
  ): Promise<{ verificado: boolean }> {
    return this.authService.statusVerificacao(uid);
  }

  /** Reenvia o e-mail de confirmacao (botao da tela de espera). */
  @SemVerificacao()
  @Post('verificacao/reenviar')
  reenviarVerificacao(@Req() req: Request): Promise<{ enviado: true }> {
    return this.authService.enviarVerificacao(extrairIdToken(req));
  }

  /** E-mail atual + status, para a pagina de Seguranca. */
  @Get('conta')
  conta(@ProfessorId() uid: string): Promise<ContaAuth> {
    return this.authService.conta(uid);
  }

  /**
   * Troca o e-mail de acesso. Precisa do ID token cru no corpo do sendOobCode,
   * dai o @Req() — o @ProfessorId() so entrega o uid.
   */
  @Post('email')
  trocarEmail(
    @ProfessorId() uid: string,
    @Req() req: Request,
    @Body() dto: TrocarEmailDto,
  ): Promise<{ enviado: true; novoEmail: string }> {
    return this.authService.trocarEmail(
      uid,
      extrairIdToken(req),
      dto.novoEmail,
      dto.senha,
    );
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

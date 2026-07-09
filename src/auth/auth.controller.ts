import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginAlunoDto } from './dto/login-aluno.dto';
import { LoginDto } from './dto/login.dto';
import { SignupDto } from './dto/signup.dto';
import { Public } from './public.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password);
  }

  /** Cadastro (plano Estagiario): cria a conta com nome + aceite legal e devolve o token. */
  @Public()
  @Post('signup')
  signup(@Body() dto: SignupDto) {
    return this.authService.signup(
      dto.email,
      dto.password,
      dto.nome,
      dto.aceiteTermos,
      dto.aceitePrivacidade,
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

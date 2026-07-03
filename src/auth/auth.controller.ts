import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginAlunoDto } from './dto/login-aluno.dto';
import { LoginDto } from './dto/login.dto';
import { Public } from './public.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password);
  }

  /** Login do aluno via portal: turmaId + PIN -> JWT customizado. */
  @Public()
  @Post('aluno')
  loginAluno(@Body() dto: LoginAlunoDto) {
    return this.authService.loginAluno(dto.turmaId, dto.pin);
  }
}

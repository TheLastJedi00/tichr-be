import { Controller, Get } from '@nestjs/common';
import { ProfessorId } from '../auth/current-user.decorator';
import { HomePayload, HomeService } from './home.service';

/** Endpoint consolidado do painel do professor (perfil + turmas). */
@Controller('home')
export class HomeController {
  constructor(private readonly homeService: HomeService) {}

  @Get()
  home(@ProfessorId() uid: string): Promise<HomePayload> {
    return this.homeService.carregar(uid);
  }
}

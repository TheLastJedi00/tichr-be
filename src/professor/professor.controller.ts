import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { ProfessorId } from '../auth/current-user.decorator';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ProfessorService } from './professor.service';

@Controller('profile')
export class ProfessorController {
  constructor(private readonly professorService: ProfessorService) {}

  @Get()
  getProfile(@ProfessorId() uid: string) {
    return this.professorService.getProfile(uid);
  }

  /** Disponibilidade do @username (debounce da tela de Configuracoes). */
  @Get('check-username')
  checkUsername(@ProfessorId() uid: string, @Query('u') u: string) {
    return this.professorService.checkUsername(uid, u ?? '');
  }

  @Put()
  updateProfile(@ProfessorId() uid: string, @Body() dto: UpdateProfileDto) {
    return this.professorService.updateProfile(uid, dto);
  }
}

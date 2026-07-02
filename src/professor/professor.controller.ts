import { Body, Controller, Get, Put } from '@nestjs/common';
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

  @Put()
  updateProfile(@ProfessorId() uid: string, @Body() dto: UpdateProfileDto) {
    return this.professorService.updateProfile(uid, dto);
  }
}

import { Body, Controller, Post } from '@nestjs/common';
import { ProfessorId } from '../auth/current-user.decorator';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { FeedbackService } from './feedback.service';

/**
 * Canal de feedback do professor.
 *
 * Sem `@UseGuards`: o AuthGuard e global (APP_GUARD) e ja exige professor com
 * e-mail verificado — o aluno cai fora sem a rota precisar dizer nada.
 */
@Controller('feedbacks')
export class FeedbackController {
  constructor(private readonly feedbacks: FeedbackService) {}

  @Post()
  criar(@ProfessorId() professorId: string, @Body() dto: CreateFeedbackDto) {
    return this.feedbacks.criar(professorId, dto);
  }
}

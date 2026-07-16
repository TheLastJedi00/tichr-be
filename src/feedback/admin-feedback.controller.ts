import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { AtualizarFeedbackDto } from './dto/atualizar-feedback.dto';
import { FeedbackService } from './feedback.service';

/**
 * Caixa de entrada da triagem — restrita a administradores.
 *
 * `AdminGuard` le `professores/{uid}.isAdmin` a cada request (nao ha `role:
 * admin`; claim e ADMIN_EMAILS foram tentados e rejeitados). Mesmo desenho do
 * AdminCupomController: controller admin morando no modulo da feature.
 *
 * A inbox e REST, nao onSnapshot: `feedbacks` carrega e-mail, nome e texto de
 * todo professor, e as Firestore Rules nao conseguiriam proteger a colecao — o
 * front nao tem sessao do Firebase Auth, entao `request.auth` e sempre null e
 * so restaria `if true` (publico) ou `if false`.
 */
@UseGuards(AdminGuard)
@Controller('admin/feedbacks')
export class AdminFeedbackController {
  constructor(private readonly feedbacks: FeedbackService) {}

  @Get()
  listar() {
    return this.feedbacks.listar();
  }

  @Patch(':id')
  atualizar(@Param('id') id: string, @Body() dto: AtualizarFeedbackDto) {
    return this.feedbacks.atualizar(id, dto);
  }
}

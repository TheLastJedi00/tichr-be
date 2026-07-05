import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ProfessorId } from '../auth/current-user.decorator';
import { CriarPartidaDto } from './dto/criar-partida.dto';
import { DistribuirDto } from './dto/distribuir.dto';
import { WorMatchService } from './wor-match.service';

/** Controle da partida pelo professor (projetor/orquestrador). */
@Controller('wor')
export class WorMatchController {
  constructor(private readonly service: WorMatchService) {}

  @Post('jogos/:jogoId/partida')
  criar(
    @ProfessorId() uid: string,
    @Param('jogoId') jogoId: string,
    @Body() dto: CriarPartidaDto,
  ) {
    return this.service.criar(uid, jogoId, dto.turmaId);
  }

  @Get('matches/:id')
  view(@Param('id') id: string) {
    return this.service.view(id);
  }

  @Post('matches/:id/distribuir')
  distribuir(
    @ProfessorId() uid: string,
    @Param('id') id: string,
    @Body() dto: DistribuirDto,
  ) {
    return this.service.distribuir(uid, id, dto.numeroEquipes);
  }

  @Post('matches/:id/iniciar')
  iniciar(@ProfessorId() uid: string, @Param('id') id: string) {
    return this.service.iniciar(uid, id);
  }
}

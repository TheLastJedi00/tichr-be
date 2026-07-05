import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ProfessorId } from '../auth/current-user.decorator';
import { CreateWorJogoDto } from './dto/create-wor-jogo.dto';
import { UpdateWorJogoDto } from './dto/update-wor-jogo.dto';
import { WorJogoService } from './wor-jogo.service';

/** Arsenal do Tichr Wor: CRUD das batalhas do professor. */
@Controller('wor/jogos')
export class WorJogoController {
  constructor(private readonly service: WorJogoService) {}

  @Get()
  listar(@ProfessorId() uid: string) {
    return this.service.listar(uid);
  }

  @Get(':id')
  obter(@ProfessorId() uid: string, @Param('id') id: string) {
    return this.service.obter(uid, id);
  }

  @Post()
  criar(@ProfessorId() uid: string, @Body() dto: CreateWorJogoDto) {
    return this.service.criar(uid, dto);
  }

  @Put(':id')
  atualizar(
    @ProfessorId() uid: string,
    @Param('id') id: string,
    @Body() dto: UpdateWorJogoDto,
  ) {
    return this.service.atualizar(uid, id, dto);
  }

  @Delete(':id')
  remover(@ProfessorId() uid: string, @Param('id') id: string) {
    return this.service.remover(uid, id);
  }
}

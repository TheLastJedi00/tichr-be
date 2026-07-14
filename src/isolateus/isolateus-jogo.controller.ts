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
import { CreateIsolateusJogoDto } from './dto/create-isolateus-jogo.dto';
import { IsolateusJogoService } from './isolateus-jogo.service';

/** Estúdio do Tichr Isolateus: CRUD da definição da investigação (PhD). */
@Controller('isolateus/jogos')
export class IsolateusJogoController {
  constructor(private readonly jogos: IsolateusJogoService) {}

  @Get()
  listar(@ProfessorId() professorId: string) {
    return this.jogos.listar(professorId);
  }

  @Get(':id')
  obter(@ProfessorId() professorId: string, @Param('id') id: string) {
    return this.jogos.obter(professorId, id);
  }

  @Post()
  criar(
    @ProfessorId() professorId: string,
    @Body() dto: CreateIsolateusJogoDto,
  ) {
    return this.jogos.criar(professorId, dto);
  }

  @Put(':id')
  atualizar(
    @ProfessorId() professorId: string,
    @Param('id') id: string,
    @Body() dto: CreateIsolateusJogoDto,
  ) {
    return this.jogos.atualizar(professorId, id, dto);
  }

  @Delete(':id')
  remover(@ProfessorId() professorId: string, @Param('id') id: string) {
    return this.jogos.remover(professorId, id);
  }
}

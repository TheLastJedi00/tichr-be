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
import { GerarArsenalDto } from './dto/gerar-arsenal.dto';
import { UpdateWorJogoDto } from './dto/update-wor-jogo.dto';
import { WorJogoService } from './wor-jogo.service';
import { WorIaService } from './wor-ia.service';

/** Arsenal do Tichr Wor: CRUD das batalhas do professor. */
@Controller('wor/jogos')
export class WorJogoController {
  constructor(
    private readonly service: WorJogoService,
    private readonly ia: WorIaService,
  ) {}

  /** Forja o arsenal por IA — 5 palavras com 3 dicas (rate limit 1×/dia). Sub-rota fixa antes de :id. */
  @Post('arsenal')
  gerarArsenal(@ProfessorId() uid: string, @Body() dto: GerarArsenalDto) {
    return this.ia.gerarArsenal(uid, dto);
  }

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

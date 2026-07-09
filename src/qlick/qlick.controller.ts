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
import { CreateQlickDto } from './dto/create-qlick.dto';
import { GerarPerguntasDto } from './dto/gerar-perguntas.dto';
import { QlickIaService } from './qlick-ia.service';
import { QlickService } from './qlick.service';

/** Estúdio do Tichr Qlick: CRUD da definição do questionário (PhD). */
@Controller('qlicks')
export class QlickController {
  constructor(
    private readonly qlickService: QlickService,
    private readonly ia: QlickIaService,
  ) {}

  /**
   * Geração de perguntas por IA (rota fixa antes das rotas com `:id`). Rate limit
   * 1×/dia por professor (separado do Wor); PhD. Devolve um lote de perguntas.
   */
  @Post('ia/perguntas')
  gerarPerguntas(
    @ProfessorId() professorId: string,
    @Body() dto: GerarPerguntasDto,
  ) {
    return this.ia.gerarPerguntas(professorId, dto);
  }

  @Get()
  listar(@ProfessorId() professorId: string) {
    return this.qlickService.listar(professorId);
  }

  @Get(':id')
  obter(@ProfessorId() professorId: string, @Param('id') id: string) {
    return this.qlickService.obter(professorId, id);
  }

  @Post()
  criar(@ProfessorId() professorId: string, @Body() dto: CreateQlickDto) {
    return this.qlickService.criar(professorId, dto);
  }

  @Put(':id')
  atualizar(
    @ProfessorId() professorId: string,
    @Param('id') id: string,
    @Body() dto: CreateQlickDto,
  ) {
    return this.qlickService.atualizar(professorId, id, dto);
  }

  /** Atribui (substitui) as turmas do Qlick — N:N (biblioteca ↔ turmas). */
  @Put(':id/turmas')
  atribuirTurmas(
    @ProfessorId() professorId: string,
    @Param('id') id: string,
    @Body() dto: { turmaIds: string[] },
  ) {
    return this.qlickService.atribuirTurmas(professorId, id, dto.turmaIds ?? []);
  }

  @Delete(':id')
  remover(@ProfessorId() professorId: string, @Param('id') id: string) {
    return this.qlickService.remover(professorId, id);
  }
}

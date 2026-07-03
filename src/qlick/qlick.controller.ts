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
import { QlickService } from './qlick.service';

/** Estúdio do Tichr Qlick: CRUD da definição do questionário (PhD). */
@Controller('qlicks')
export class QlickController {
  constructor(private readonly qlickService: QlickService) {}

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

  @Delete(':id')
  remover(@ProfessorId() professorId: string, @Param('id') id: string) {
    return this.qlickService.remover(professorId, id);
  }
}

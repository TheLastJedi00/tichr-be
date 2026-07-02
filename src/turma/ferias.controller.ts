import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ProfessorId } from '../auth/current-user.decorator';
import { CreateFeriasDto } from './dto/create-ferias.dto';
import { TurmaService } from './turma.service';

@Controller('ferias')
export class FeriasController {
  constructor(private readonly turmaService: TurmaService) {}

  @Get()
  listar(@ProfessorId() professorId: string) {
    return this.turmaService.listarFerias(professorId);
  }

  @Post()
  criar(@ProfessorId() professorId: string, @Body() dto: CreateFeriasDto) {
    return this.turmaService.criarFerias(professorId, dto);
  }

  @Delete(':id')
  remover(@ProfessorId() professorId: string, @Param('id') id: string) {
    return this.turmaService.removerFerias(professorId, id);
  }
}

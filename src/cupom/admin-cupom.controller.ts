import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { CupomService } from './cupom.service';
import { CreateCupomDto } from './dto/create-cupom.dto';
import { UpdateCupomDto } from './dto/update-cupom.dto';

/** CRUD de cupons — restrito a administradores. */
@UseGuards(AdminGuard)
@Controller('admin/cupons')
export class AdminCupomController {
  constructor(private readonly cupons: CupomService) {}

  @Get()
  listar() {
    return this.cupons.listar();
  }

  @Post()
  criar(@Body() dto: CreateCupomDto) {
    return this.cupons.criar(dto);
  }

  @Patch(':id')
  atualizar(@Param('id') id: string, @Body() dto: UpdateCupomDto) {
    return this.cupons.atualizar(id, dto);
  }

  @Delete(':id')
  remover(@Param('id') id: string) {
    return this.cupons.remover(id);
  }
}

import { Body, Controller, Post } from '@nestjs/common';
import { ProfessorId } from '../auth/current-user.decorator';
import { CupomService } from './cupom.service';
import { AplicarCupomDto } from './dto/aplicar-cupom.dto';

/** Aplicacao de cupom no checkout (professor autenticado). */
@Controller('checkout')
export class CupomController {
  constructor(private readonly cupons: CupomService) {}

  @Post('cupom')
  aplicar(@ProfessorId() uid: string, @Body() dto: AplicarCupomDto) {
    return this.cupons.aplicar(uid, dto.codigo);
  }
}

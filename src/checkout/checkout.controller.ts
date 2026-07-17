import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ProfessorId } from '../auth/current-user.decorator';
import { CheckoutResposta, CheckoutService } from './checkout.service';
import { IniciarSlotDto } from './dto/iniciar-slot.dto';
import { IniciarUpgradeDto } from './dto/iniciar-upgrade.dto';
import { StatusPagamento } from './abacate-pay.service';

/**
 * Checkout de assinatura (gateway real). Diferente do mock antigo, estes
 * endpoints **nao concedem o plano na hora**: criam a cobranca e devolvem os
 * dados de pagamento. A concessao acontece no webhook (`/checkout/webhook`).
 * Excecao: admin e destino gratuito, concedidos na hora (sem cobranca).
 */
@Controller('checkout')
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  /** Inicia a troca de plano (retorna cobranca pendente ou concessao imediata). */
  @Post('upgrade')
  upgrade(
    @ProfessorId() uid: string,
    @Body() dto: IniciarUpgradeDto,
  ): Promise<CheckoutResposta> {
    return this.checkout.iniciarUpgrade(uid, dto);
  }

  /** Inicia a compra de uma vaga avulsa. */
  @Post('slot-avulso')
  slot(
    @ProfessorId() uid: string,
    @Body() dto: IniciarSlotDto,
  ): Promise<CheckoutResposta> {
    return this.checkout.iniciarSlot(uid, dto);
  }

  /** Status da cobranca (polling do front ate PAID/EXPIRED). */
  @Get('status/:billingId')
  status(
    @ProfessorId() uid: string,
    @Param('billingId') billingId: string,
  ): Promise<{ status: StatusPagamento }> {
    return this.checkout.status(uid, billingId);
  }

  /** Simula o pagamento (apenas devMode — valida o fluxo sem PIX real). */
  @Post('simular/:billingId')
  simular(
    @ProfessorId() uid: string,
    @Param('billingId') billingId: string,
  ): Promise<{ status: StatusPagamento }> {
    return this.checkout.simular(uid, billingId);
  }
}

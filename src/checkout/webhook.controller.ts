import {
  Body,
  Controller,
  HttpCode,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { CheckoutService } from './checkout.service';

/** Compara duas strings em tempo constante (evita timing attack). */
function igualSeguro(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Recebe os eventos do gateway (Abacate Pay). Rota **publica** (o gateway nao
 * manda Bearer), protegida por: (1) segredo na query — mecanismo padrao do
 * webhook, comparado em tempo constante; (2) assinatura HMAC-SHA256 sobre o
 * corpo cru, conferida **quando o header vem** (defesa extra, sem rejeitar
 * eventos legitimos que nao a enviam). A concessao e idempotente no service.
 */
@Public()
@Controller('checkout')
export class WebhookController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly config: ConfigService,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  async receber(
    @Query('webhookSecret') webhookSecret: string,
    @Req() req: RawBodyRequest<Request>,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    this.verificar(webhookSecret, req);
    await this.checkout.processarWebhook(
      body as Parameters<CheckoutService['processarWebhook']>[0],
    );
    return { ok: true };
  }

  private verificar(secret: string, req: RawBodyRequest<Request>): void {
    const esperado = this.config.get<string>('ABACATE_WEBHOOK_SECRET');
    if (!esperado || !secret || !igualSeguro(secret, esperado)) {
      throw new UnauthorizedException('Webhook nao autorizado.');
    }
    const assinatura = req.headers['x-webhook-signature'];
    if (typeof assinatura === 'string' && req.rawBody) {
      const calculada = createHmac('sha256', esperado)
        .update(req.rawBody)
        .digest('hex');
      if (!igualSeguro(calculada, assinatura)) {
        throw new UnauthorizedException('Assinatura do webhook invalida.');
      }
    }
  }
}

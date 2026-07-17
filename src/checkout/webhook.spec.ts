import { UnauthorizedException } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { CheckoutService } from './checkout.service';
import { WebhookController } from './webhook.controller';

describe('WebhookController', () => {
  let checkout: jest.Mocked<Pick<CheckoutService, 'processarWebhook'>>;

  function controller() {
    return new WebhookController(
      checkout as unknown as CheckoutService,
      { get: () => 'segredo123' } as unknown as ConfigService,
    );
  }

  const req = { headers: {}, rawBody: Buffer.from('{}') } as RawBodyRequest<Request>;

  beforeEach(() => {
    checkout = { processarWebhook: jest.fn() };
  });

  it('rejeita segredo ausente ou errado', async () => {
    await expect(
      controller().receber('errado', req, { event: 'billing.paid' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(checkout.processarWebhook).not.toHaveBeenCalled();
  });

  it('aceita segredo correto e processa o evento', async () => {
    const body = { event: 'billing.paid', data: { pixQrCode: { id: 'pix_1' } } };
    const res = await controller().receber('segredo123', req, body);
    expect(res).toEqual({ ok: true });
    expect(checkout.processarWebhook).toHaveBeenCalledWith(body);
  });

  it('rejeita assinatura HMAC invalida quando o header vem', async () => {
    const reqComAssinatura = {
      headers: { 'x-webhook-signature': 'deadbeef' },
      rawBody: Buffer.from('{"event":"billing.paid"}'),
    } as unknown as RawBodyRequest<Request>;
    await expect(
      controller().receber('segredo123', reqComAssinatura, {
        event: 'billing.paid',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

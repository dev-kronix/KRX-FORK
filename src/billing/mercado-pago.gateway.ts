import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../config/config.type';
type BillingRuntime = AllConfigType & {
  MERCADO_PAGO_ACCESS_TOKEN?: string;
  MERCADO_PAGO_WEBHOOK_SECRET?: string;
  MERCADO_PAGO_SANDBOX?: string;
};
import { createHmac, timingSafeEqual } from 'crypto';
export type ProviderPayment = {
  id: number | string;
  external_reference: string;
  status: string;
  transaction_amount: number;
  currency_id: string;
  live_mode: boolean;
  date_last_updated: string;
  transaction_amount_refunded?: number;
};
@Injectable()
export class MercadoPagoGateway {
  constructor(private readonly config: ConfigService<BillingRuntime>) {}
  get sandbox() {
    return this.config.get('MERCADO_PAGO_SANDBOX', { infer: true }) !== 'false';
  }
  get configured() {
    return Boolean(
      this.config.get('MERCADO_PAGO_ACCESS_TOKEN', { infer: true }) &&
      this.config.get('MERCADO_PAGO_WEBHOOK_SECRET', { infer: true }),
    );
  }
  private async call(path: string, body?: unknown): Promise<any> {
    if (!this.configured)
      throw new ServiceUnavailableException(
        'Pagamentos ainda não configurados.',
      );
    try {
      const response = await fetch('https://api.mercadopago.com' + path, {
        method: body ? 'POST' : 'GET',
        headers: {
          Authorization:
            'Bearer ' +
            this.config.get('MERCADO_PAGO_ACCESS_TOKEN', { infer: true }),
          'Content-Type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok)
        throw new BadGatewayException(
          'O Mercado Pago não confirmou a operação.',
        );
      return await response.json();
    } catch (error) {
      if (error instanceof BadGatewayException) throw error;
      throw new BadGatewayException(
        'Não foi possível consultar o Mercado Pago.',
      );
    }
  }
  async checkout(payment: { id: string; snapshot: any }, email: string) {
    const backend = this.config.get('app.backendDomain', { infer: true });
    const frontend = this.config.get('app.frontendDomain', { infer: true });
    if (
      !backend ||
      !frontend ||
      !String(backend).startsWith('https://') ||
      !String(frontend).startsWith('https://')
    )
      throw new ServiceUnavailableException(
        'Configure os domínios HTTPS do checkout.',
      );
    const back = new URL('/dashboard/', frontend).toString();
    const result = await this.call('/checkout/preferences', {
      items: [
        {
          id: payment.snapshot.id,
          title: 'KRX — ' + payment.snapshot.name,
          quantity: 1,
          currency_id: 'BRL',
          unit_price: payment.snapshot.priceCents / 100,
        },
      ],
      payer: { email },
      external_reference: payment.id,
      notification_url: new URL(
        '/api/v1/billing/webhooks/mercadopago',
        backend,
      ).toString(),
      back_urls: { success: back, pending: back, failure: back },
      auto_return: 'approved',
      expires: true,
      expiration_date_to: new Date(
        Date.now() + 2 * 60 * 60 * 1000,
      ).toISOString(),
    });
    const url = this.sandbox ? result.sandbox_init_point : result.init_point;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadGatewayException(
        'Checkout inválido retornado pelo provedor.',
      );
    }
    if (
      parsed.protocol !== 'https:' ||
      !/(^|\.)mercadopago\.(com|com\.br)$/.test(parsed.hostname)
    )
      throw new BadGatewayException(
        'Checkout inválido retornado pelo provedor.',
      );
    return url as string;
  }
  async payment(id: string): Promise<ProviderPayment> {
    if (!/^\d{1,30}$/.test(id))
      throw new UnauthorizedException('Identificador inválido.');
    return this.call('/v1/payments/' + id);
  }
  verify(id: string, requestId: string, signature: string) {
    const secret = this.config.get('MERCADO_PAGO_WEBHOOK_SECRET', {
      infer: true,
    });
    if (!secret)
      throw new ServiceUnavailableException('Webhook não configurado.');
    const entries = signature.split(',').map((s) => s.trim().split('='));
    if (
      entries.filter((e) => e[0] === 'ts').length !== 1 ||
      entries.filter((e) => e[0] === 'v1').length !== 1
    )
      throw new UnauthorizedException('Assinatura inválida.');
    const parts = Object.fromEntries(entries);
    if (
      !/^\d{1,30}$/.test(id) ||
      !/^[a-zA-Z0-9-]{1,160}$/.test(requestId) ||
      !/^\d{10,13}$/.test(parts.ts || '') ||
      !/^[a-f0-9]{64}$/i.test(parts.v1 || '')
    )
      throw new UnauthorizedException('Assinatura inválida.');
    const expected = createHmac('sha256', secret)
      .update(`id:${id};request-id:${requestId};ts:${parts.ts};`)
      .digest();
    if (!timingSafeEqual(expected, Buffer.from(parts.v1, 'hex')))
      throw new UnauthorizedException('Assinatura inválida.');
  }
}

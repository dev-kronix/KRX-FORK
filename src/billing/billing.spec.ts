import { PGlite } from '@electric-sql/pglite';
import { DataSource, QueryRunner } from 'typeorm';
import { randomUUID, createHmac } from 'crypto';
import { ConfigService } from '@nestjs/config';
import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import validationOptions from '../utils/validation-options';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { PlatformService } from '../platform/platform.service';
import { PlatformFoundation1791323000000 } from '../database/migrations/1791323000000-PlatformFoundation';
import { Billing1791325000000 } from '../database/migrations/1791325000000-Billing';
import { BillingService } from './billing.service';
import { MercadoPagoGateway, ProviderPayment } from './mercado-pago.gateway';
import {
  BillingController,
  AdminBillingController,
} from './billing.controller';
import { PlanDto } from './billing.dto';
const basePlan: PlanDto = {
  id: 'starter',
  name: 'Starter',
  description: 'Plano de teste',
  priceCents: 1290,
  creditsPerCycle: 100000,
  billingPeriodDays: 30,
  maxActiveKeys: 7,
  apiRateLimit: 30,
  normal: true,
  freefire: true,
  consultas: false,
  active: true,
  public: true,
};

describe('Billing transactions', () => {
  let pg: PGlite;
  let platform: PlatformService;
  let billing: BillingService;
  let app: INestApplication;
  const gateway = {
    configured: true,
    sandbox: true,
    checkout: jest.fn(),
    payment: jest.fn(),
    verify: jest.fn(),
  };
  const jwt = new JwtService({ secret: 'billing-test-secret' });
  const token = (id = 2, role = 2) =>
    jwt.sign({ id, role: { id: role }, sessionId: 1 });
  beforeAll(async () => {
    pg = new PGlite();
    await pg.exec(
      `CREATE FUNCTION uuid_generate_v4() RETURNS uuid LANGUAGE SQL AS 'SELECT gen_random_uuid()'; CREATE TABLE "user" ("id" integer PRIMARY KEY,"roleId" integer,"statusId" integer,"deletedAt" timestamp,"email" varchar);INSERT INTO "user" VALUES (1,1,1,NULL,'admin@example.com'),(2,2,1,NULL,'buyer@example.com'),(3,2,1,NULL,'other@example.com');`,
    );
    const q = {
      query: (sql: string) => pg.exec(sql),
    } as unknown as QueryRunner;
    await new PlatformFoundation1791323000000().up(q);
    await new Billing1791325000000().up(q);
    const raw = (sql: string, r: { rows: unknown[]; affectedRows?: number }) =>
      /^(UPDATE|DELETE)\b/i.test(sql.trim())
        ? [r.rows, r.affectedRows ?? 0]
        : r.rows;
    const query = async (sql: string, params?: unknown[]) =>
      raw(sql, await pg.query(sql, params));
    const db = {
      query,
      manager: { query },
      transaction: (cb: (m: unknown) => Promise<unknown>) =>
        pg.transaction((tx) =>
          cb({
            query: async (sql: string, params?: unknown[]) =>
              raw(sql, await tx.query(sql, params)),
          }),
        ),
    } as unknown as DataSource;
    platform = new PlatformService(db);
    billing = new BillingService(
      db,
      platform,
      gateway as unknown as MercadoPagoGateway,
    );
    const module = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [BillingController, AdminBillingController],
      providers: [
        JwtStrategy,
        {
          provide: ConfigService,
          useValue: { getOrThrow: () => 'billing-test-secret' },
        },
        { provide: BillingService, useValue: billing },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    app.useGlobalPipes(new ValidationPipe(validationOptions));
    await app.init();
  }, 30000);
  beforeEach(async () => {
    await pg.exec(
      'TRUNCATE "credit_account","api_key","credit_ledger","api_usage","billing_payment","billing_subscription","billing_audit" CASCADE;UPDATE "billing_plan" SET "active" = false,"public" = false;',
    );
    gateway.configured = true;
    gateway.checkout
      .mockReset()
      .mockResolvedValue('https://www.mercadopago.com.br/checkout/v1/test');
    gateway.payment.mockReset();
    gateway.verify.mockReset();
    await billing.savePlan(1, { ...basePlan });
  });
  afterAll(async () => {
    await app?.close();
    await pg?.close();
  });
  const checkout = (id = 2, requestId: string = randomUUID()) =>
    billing.checkout(id, { planId: 'starter', requestId });
  const provider = (
    id: string,
    overrides: Partial<ProviderPayment> = {},
  ): ProviderPayment => ({
    id: '12345',
    external_reference: id,
    status: 'approved',
    transaction_amount: 12.9,
    currency_id: 'BRL',
    live_mode: false,
    date_last_updated: new Date().toISOString(),
    ...overrides,
  });
  it('should use authenticated users and protect admin editing', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/billing/checkout')
      .send({ planId: 'starter', requestId: randomUUID() })
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/admin/billing/plans')
      .auth(token(), { type: 'bearer' })
      .send(basePlan)
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/admin/billing/plans')
      .auth(token(1, 1), { type: 'bearer' })
      .send({ ...basePlan, priceCents: 0 })
      .expect(422);
    const result = await request(app.getHttpServer())
      .get('/api/v1/billing/plans')
      .expect(200);
    expect(result.body.plans).toHaveLength(1);
    expect(result.body.payments.recurring).toBe(false);
  });
  it('should disable checkout without credentials or an active public plan', async () => {
    gateway.configured = false;
    await expect(checkout()).rejects.toMatchObject({ status: 503 });
    gateway.configured = true;
    await billing.savePlan(1, { ...basePlan, active: false });
    await expect(checkout()).rejects.toMatchObject({ status: 404 });
  });
  it('should snapshot price and credits and reuse a checkout safely', async () => {
    const id = randomUUID();
    const a = await checkout(2, id);
    const b = await checkout(2, id);
    expect(a.id).toBe(b.id);
    expect(gateway.checkout).toHaveBeenCalledTimes(1);
    await billing.savePlan(1, {
      ...basePlan,
      priceCents: 5000,
      creditsPerCycle: 3,
    });
    await billing.applyProviderPayment(provider(a.id));
    expect((await platform.summary(2)).balance).toBe(100000);
  });
  it('should not trust submitted prices or credit counts', async () => {
    const r = await request(app.getHttpServer())
      .post('/api/v1/billing/checkout')
      .auth(token(), { type: 'bearer' })
      .send({
        planId: 'starter',
        requestId: randomUUID(),
        priceCents: 1,
        creditsPerCycle: 99999999,
      })
      .expect(201);
    expect(r.body.amountCents).toBe(1290);
    expect(r.body.creditsGranted).toBe(100000);
  });
  it('should credit and extend an approved purchase once under retries', async () => {
    const order = await checkout();
    const p = provider(order.id);
    await Promise.all(
      Array.from({ length: 5 }, () => billing.applyProviderPayment(p)),
    );
    expect((await platform.summary(2)).balance).toBe(100000);
    const sub = await billing.subscription(2);
    const expires = String(sub.expiresAt);
    await billing.applyProviderPayment(p);
    expect(String((await billing.subscription(2)).expiresAt)).toBe(expires);
    expect(
      (await platform.history(2, { page: 1, limit: 20 }, true)).data,
    ).toHaveLength(1);
  });
  it('should reject wrong amounts, currencies and test/live environments', async () => {
    const order = await checkout();
    for (const change of [
      { transaction_amount: 0.01 },
      { currency_id: 'USD' },
      { live_mode: true },
      { live_mode: undefined },
    ])
      await expect(
        billing.applyProviderPayment(provider(order.id, change)),
      ).rejects.toMatchObject({ status: 400 });
    expect((await platform.summary(2)).balance).toBe(0);
  });
  it('should never credit pending, rejected or cancelled payments', async () => {
    const order = await checkout();
    for (const status of ['pending', 'rejected', 'cancelled'])
      await billing.applyProviderPayment(provider(order.id, { status }));
    expect((await platform.summary(2)).balance).toBe(0);
    expect((await billing.subscription(2)).status).toBe('free');
  });
  it('should isolate payment owners and verify provider references', async () => {
    const order = await checkout();
    gateway.payment.mockResolvedValue(provider(order.id));
    await expect(billing.reconcile(3, order.id, '12345')).rejects.toMatchObject(
      { status: 404 },
    );
    gateway.payment.mockResolvedValue(provider(randomUUID()));
    await expect(billing.reconcile(2, order.id, '12345')).rejects.toMatchObject(
      { status: 400 },
    );
    expect((await billing.payments(3, { page: 1, limit: 20 })).data).toEqual(
      [],
    );
  });
  it('should roll back all credits if subscription activation fails', async () => {
    const order = await checkout();
    await pg.exec(
      `CREATE FUNCTION reject_subscription() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'activation failure'; END; $$;CREATE TRIGGER reject_subscription BEFORE INSERT ON "billing_subscription" FOR EACH ROW EXECUTE FUNCTION reject_subscription();`,
    );
    try {
      await expect(
        billing.applyProviderPayment(provider(order.id)),
      ).rejects.toThrow('activation failure');
      expect((await platform.summary(2)).balance).toBe(0);
      expect(
        (await platform.history(2, { page: 1, limit: 20 }, true)).data,
      ).toEqual([]);
    } finally {
      await pg.exec(
        'DROP TRIGGER reject_subscription ON "billing_subscription";DROP FUNCTION reject_subscription();',
      );
    }
  });
  it('should apply plan key limits and return to the free limit on expiration', async () => {
    const order = await checkout();
    await billing.applyProviderPayment(provider(order.id));
    for (let i = 0; i < 7; i++) await platform.createKey(2, 'Key ' + i);
    await expect(platform.createKey(2, 'Excess')).rejects.toMatchObject({
      status: 409,
    });
    await pg.exec(
      'UPDATE "billing_subscription" SET "expiresAt" = now() - interval \'1 day\'',
    );
    expect((await platform.billingAccess(2)).maxActiveKeys).toBe(5);
    expect((await billing.subscription(2)).status).toBe('expired');
    expect((await platform.summary(2)).balance).toBe(100000);
  });
  it('should hold reversed payments for admin review without negative balances', async () => {
    const order = await checkout();
    await billing.applyProviderPayment(provider(order.id));
    const key = await platform.createKey(2, 'Bot');
    await billing.applyProviderPayment(
      provider(order.id, {
        status: 'refunded',
        date_last_updated: new Date(Date.now() + 1000).toISOString(),
      }),
    );
    await expect(platform.authenticateKey(key.key)).rejects.toMatchObject({
      status: 403,
    });
    expect((await billing.subscription(2)).status).toBe('review_required');
    await expect(checkout()).rejects.toMatchObject({ status: 403 });
    await billing.resolveReview(
      1,
      2,
      'Créditos reconciliados pelo administrador',
    );
    await billing.applyProviderPayment(
      provider(order.id, {
        status: 'refunded',
        date_last_updated: new Date(Date.now() + 2000).toISOString(),
      }),
    );
    expect((await billing.subscription(2)).status).toBe('expired');
    expect((await platform.authenticateKey(key.key)).userId).toBe(2);
  });
  it('should ignore out-of-order notifications and avoid provider-ID reuse', async () => {
    const a = await checkout();
    await billing.applyProviderPayment(provider(a.id));
    await billing.applyProviderPayment(
      provider(a.id, {
        status: 'refunded',
        date_last_updated: new Date(0).toISOString(),
      }),
    );
    expect((await billing.subscription(2)).status).toBe('active');
    const b = await checkout();
    await expect(
      billing.applyProviderPayment(provider(b.id)),
    ).rejects.toThrow();
    expect((await platform.summary(2)).balance).toBe(100000);
  });
  it('should authenticate a webhook before fetching and use provider state instead of body status', async () => {
    const verifier = new MercadoPagoGateway(
      new ConfigService({ MERCADO_PAGO_WEBHOOK_SECRET: 'test-secret' }),
    );
    gateway.verify.mockImplementation((id, requestId, signature) =>
      verifier.verify(id, requestId, signature),
    );
    await request(app.getHttpServer())
      .post('/api/v1/billing/webhooks/mercadopago?data.id=12345')
      .send({ status: 'approved' })
      .expect(401);
    expect(gateway.payment).not.toHaveBeenCalled();
    const order = await checkout();
    gateway.payment.mockResolvedValue(
      provider(order.id, { status: 'pending' }),
    );
    const ts = String(Date.now());
    const requestId = randomUUID();
    const signature =
      'ts=' +
      ts +
      ',v1=' +
      createHmac('sha256', 'test-secret')
        .update(`id:12345;request-id:${requestId};ts:${ts};`)
        .digest('hex');
    await request(app.getHttpServer())
      .post('/api/v1/billing/webhooks/mercadopago?data.id=12345')
      .set('x-request-id', requestId)
      .set('x-signature', signature)
      .send({ status: 'approved', transaction_amount: 12.9 })
      .expect(200);
    expect((await platform.summary(2)).balance).toBe(0);
    gateway.payment.mockResolvedValue(provider(order.id));
    await request(app.getHttpServer())
      .post('/api/v1/billing/webhooks/mercadopago?data.id=12345')
      .set('x-request-id', requestId)
      .set('x-signature', signature)
      .send({ status: 'rejected' })
      .expect(200);
    expect((await platform.summary(2)).balance).toBe(100000);
  });
  it('should keep a failed checkout auditable and avoid recreating it on retry', async () => {
    const id = randomUUID();
    gateway.checkout.mockRejectedValue(new Error('Provider offline'));
    await expect(checkout(2, id)).rejects.toThrow('Provider offline');
    await expect(checkout(2, id)).rejects.toMatchObject({ status: 409 });
    expect(
      (await billing.payments(2, { page: 1, limit: 20 })).data[0].status,
    ).toBe('checkout_error');
    expect(gateway.checkout).toHaveBeenCalledTimes(1);
  });
});

describe('Mercado Pago webhook signature', () => {
  const gateway = new MercadoPagoGateway(
    new ConfigService({ MERCADO_PAGO_WEBHOOK_SECRET: 'test-secret' }),
  );
  const ts = String(Date.now());
  const id = '12345';
  const requestId = randomUUID();
  const signed = (otherId = id) =>
    'ts=' +
    ts +
    ',v1=' +
    createHmac('sha256', 'test-secret')
      .update(`id:${otherId};request-id:${requestId};ts:${ts};`)
      .digest('hex');
  it('should accept a valid HMAC and reject altered IDs and missing fields', () => {
    expect(() => gateway.verify(id, requestId, signed())).not.toThrow();
    expect(() => gateway.verify('999', requestId, signed())).toThrow();
    expect(() => gateway.verify(id, '', signed())).toThrow();
    expect(() =>
      gateway.verify(id, requestId, 'ts=' + ts + ',v1=00'),
    ).toThrow();
  });
});

describe('Mercado Pago checkout contract', () => {
  const gateway = new MercadoPagoGateway(
    new ConfigService({
      MERCADO_PAGO_ACCESS_TOKEN: 'test-token',
      MERCADO_PAGO_WEBHOOK_SECRET: 'test-secret',
      MERCADO_PAGO_SANDBOX: 'true',
      app: {
        backendDomain: 'https://api.krx.test',
        frontendDomain: 'https://krx.test',
      },
    }),
  );
  afterEach(() => jest.restoreAllMocks());
  it('should send server price and order reference and select sandbox checkout', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          sandbox_init_point: 'https://www.mercadopago.com.br/checkout/v1/test',
          init_point: 'https://www.mercadopago.com.br/checkout/v1/live',
        }),
      ),
    );
    const id = randomUUID();
    const url = await gateway.checkout(
      { id, snapshot: basePlan },
      'buyer@example.com',
    );
    expect(url).toContain('/test');
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.mercadopago.com/checkout/preferences',
    );
    const payload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(payload.items[0]).toMatchObject({
      unit_price: 12.9,
      quantity: 1,
      currency_id: 'BRL',
    });
    expect(payload.external_reference).toBe(id);
    expect(payload.notification_url).toBe(
      'https://api.krx.test/api/v1/billing/webhooks/mercadopago',
    );
    expect(payload.back_urls.success).toBe('https://krx.test/dashboard/');
  });
  it('should reject untrusted checkout hosts and hide provider response errors', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          sandbox_init_point: 'https://mercadopago.com.br.attacker.test/pay',
        }),
      ),
    );
    await expect(
      gateway.checkout(
        { id: randomUUID(), snapshot: basePlan },
        'buyer@example.com',
      ),
    ).rejects.toMatchObject({ status: 502 });
    fetchMock.mockResolvedValue(
      new Response('secret-provider-details', { status: 400 }),
    );
    await expect(gateway.payment('12345')).rejects.toThrow(
      'O Mercado Pago não confirmou a operação.',
    );
  });
});

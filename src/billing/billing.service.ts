import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { randomUUID } from 'crypto';
import { isUUID } from 'class-validator';
import { PlatformService } from '../platform/platform.service';
import { PaginationDto } from '../platform/platform.dto';
import { CheckoutDto, PlanDto } from './billing.dto';
import { MercadoPagoGateway } from './mercado-pago.gateway';

@Injectable()
export class BillingService {
  constructor(
    private readonly db: DataSource,
    private readonly platform: PlatformService,
    private readonly gateway: MercadoPagoGateway,
  ) {}
  configuration() {
    return {
      enabled: this.gateway.configured,
      sandbox: this.gateway.sandbox,
      provider: 'mercado_pago',
      recurring: false,
    };
  }
  async plans(adminId?: number) {
    if (adminId) await this.platform.activeUser(adminId, this.db.manager, true);
    return this.db.query(
      'SELECT * FROM "billing_plan"' +
        (adminId ? '' : ' WHERE "active" = true AND "public" = true') +
        ' ORDER BY "priceCents", "id"',
    );
  }
  async savePlan(actorId: number, dto: PlanDto) {
    return this.db.transaction(async (m) => {
      await this.platform.activeUser(actorId, m, true);
      const fields = [
        'id',
        'name',
        'description',
        'priceCents',
        'creditsPerCycle',
        'billingPeriodDays',
        'maxActiveKeys',
        'apiRateLimit',
        'normal',
        'freefire',
        'consultas',
        'active',
        'public',
      ];
      const [plan] = await m.query(
        `INSERT INTO "billing_plan" (${fields.map((f) => '"' + f + '"').join(',')}) VALUES (${fields.map((_, i) => '$' + (i + 1)).join(',')}) ON CONFLICT ("id") DO UPDATE SET ${fields
          .slice(1)
          .map((f) => '"' + f + '" = EXCLUDED."' + f + '"')
          .join(',')} RETURNING *`,
        fields.map((f) => (dto as any)[f]),
      );
      await this.audit(m, actorId, null, 'plan.saved', { plan });
      return plan;
    });
  }
  async subscription(userId: number) {
    await this.platform.activeUser(userId);
    const [sub] = await this.db.query(
      'SELECT "snapshot", "expiresAt", "held" FROM "billing_subscription" WHERE "userId" = $1',
      [userId],
    );
    return {
      plan: sub?.snapshot ?? null,
      expiresAt: sub?.expiresAt ?? null,
      status: sub
        ? sub.held
          ? 'review_required'
          : new Date(sub.expiresAt).getTime() > Date.now()
            ? 'active'
            : 'expired'
        : 'free',
    };
  }
  private publicPayment(p: any) {
    return {
      id: p.id,
      planId: p.planId,
      planName: p.snapshot.name,
      amountCents: p.snapshot.priceCents,
      currency: 'BRL',
      creditsGranted: p.snapshot.creditsPerCycle,
      status: p.status,
      checkoutUrl: p.checkoutUrl,
      providerPaymentId: p.providerPaymentId,
      creditedAt: p.creditedAt,
      createdAt: p.createdAt,
      userId: p.userId,
    };
  }
  async payments(userId: number, page: PaginationDto, admin = false) {
    await this.platform.activeUser(userId, this.db.manager, admin);
    const rows = await this.db.query(
      'SELECT * FROM "billing_payment"' +
        (admin ? '' : ' WHERE "userId" = $3') +
        ' ORDER BY "createdAt" DESC, "id" DESC LIMIT $1 OFFSET $2',
      [
        page.limit + 1,
        (page.page - 1) * page.limit,
        ...(admin ? [] : [userId]),
      ],
    );
    return {
      data: rows.slice(0, page.limit).map((p: any) => this.publicPayment(p)),
      hasNextPage: rows.length > page.limit,
      page: page.page,
    };
  }
  async checkout(userId: number, dto: CheckoutDto) {
    if (!this.gateway.configured)
      throw new ServiceUnavailableException(
        'Pagamentos ainda não configurados.',
      );
    const order = await this.db.transaction(async (m) => {
      await this.platform.activeUser(userId, m);
      await this.lockAccount(m, userId);
      await this.platform.billingAccess(userId, m);
      const [existing] = await m.query(
        'SELECT * FROM "billing_payment" WHERE "userId" = $1 AND "requestId" = $2',
        [userId, dto.requestId],
      );
      if (existing) {
        if (existing.planId !== dto.planId)
          throw new ConflictException('Identificador usado para outro plano.');
        return { payment: existing, created: false };
      }
      const [plan] = await m.query(
        'SELECT * FROM "billing_plan" WHERE "id" = $1 AND "active" = true AND "public" = true',
        [dto.planId],
      );
      if (!plan) throw new NotFoundException('Plano indisponível.');
      const [payment] = await m.query(
        'INSERT INTO "billing_payment" ("id","userId","requestId","planId","snapshot") VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [randomUUID(), userId, dto.requestId, dto.planId, JSON.stringify(plan)],
      );
      return { payment, created: true };
    });
    if (!order.created) {
      if (!order.payment.checkoutUrl)
        throw new ConflictException(
          'Checkout em processamento ou com resultado incerto. Consulte seus pagamentos antes de tentar uma nova compra.',
        );
      return this.publicPayment(order.payment);
    }
    const [user] = await this.db.query(
      'SELECT "email" FROM "user" WHERE "id" = $1',
      [userId],
    );
    try {
      if (!user.email)
        throw new BadRequestException(
          'A conta precisa de um e-mail para comprar.',
        );
      const url = await this.gateway.checkout(order.payment, user.email);
      const [rows] = await this.db.query(
        `UPDATE "billing_payment" SET "checkoutUrl" = $2, "status" = CASE WHEN "status" = 'creating' THEN 'pending' ELSE "status" END WHERE "id" = $1 RETURNING *`,
        [order.payment.id, url],
      );
      return this.publicPayment(rows[0]);
    } catch (error) {
      await this.db.query(
        `UPDATE "billing_payment" SET "status" = 'checkout_error' WHERE "id" = $1 AND "creditedAt" IS NULL`,
        [order.payment.id],
      );
      throw error;
    }
  }
  async reconcile(
    userId: number,
    orderId: string,
    providerId: string,
    admin = false,
  ) {
    await this.platform.activeUser(userId, this.db.manager, admin);
    const [order] = await this.db.query(
      'SELECT "id" FROM "billing_payment" WHERE "id" = $1' +
        (admin ? '' : ' AND "userId" = $2'),
      admin ? [orderId] : [orderId, userId],
    );
    if (!order) throw new NotFoundException('Pagamento não encontrado.');
    const result = await this.gateway.payment(providerId);
    if (
      String(result.id) !== providerId ||
      result.external_reference !== orderId
    )
      throw new BadRequestException('O pagamento não corresponde à compra.');
    return this.applyProviderPayment(result);
  }
  async webhook(id: string, requestId: string, signature: string) {
    this.gateway.verify(id, requestId, signature);
    const p = await this.gateway.payment(id);
    if (String(p.id) !== id)
      throw new BadRequestException('Pagamento divergente.');
    if (!isUUID(p.external_reference)) return { received: true };
    return this.applyProviderPayment(p);
  }
  private async lockAccount(m: EntityManager, userId: number) {
    await m.query(
      'INSERT INTO "credit_account" ("userId") VALUES ($1) ON CONFLICT DO NOTHING',
      [userId],
    );
    const [account] = await m.query(
      'SELECT "balance" FROM "credit_account" WHERE "userId" = $1 FOR UPDATE',
      [userId],
    );
    return account;
  }
  private async audit(
    m: EntityManager,
    actorId: number | null,
    paymentId: string | null,
    action: string,
    details: any,
  ) {
    await m.query(
      'INSERT INTO "billing_audit" ("actorId","paymentId","action","details") VALUES ($1,$2,$3,$4)',
      [actorId, paymentId, action, JSON.stringify(details)],
    );
  }
  async applyProviderPayment(
    provider: Awaited<ReturnType<MercadoPagoGateway['payment']>>,
  ) {
    if (
      !isUUID(provider.external_reference) ||
      !/^\d{1,30}$/.test(String(provider.id))
    )
      throw new BadRequestException('Referência inválida.');
    return this.db.transaction(async (m) => {
      const [lookup] = await m.query(
        'SELECT "userId" FROM "billing_payment" WHERE "id" = $1',
        [provider.external_reference],
      );
      if (!lookup) return { received: true };
      const account = await this.lockAccount(m, lookup.userId);
      const [p] = await m.query(
        'SELECT * FROM "billing_payment" WHERE "id" = $1 FOR UPDATE',
        [provider.external_reference],
      );
      if (p.status === 'review_resolved') return this.publicPayment(p);
      const updated = new Date(provider.date_last_updated);
      const cents = Number(provider.transaction_amount) * 100;
      if (
        !Number.isFinite(cents) ||
        Math.abs(cents - Math.round(cents)) > 0.00001 ||
        Math.round(cents) !== p.snapshot.priceCents ||
        provider.currency_id !== 'BRL' ||
        provider.live_mode !== !this.gateway.sandbox ||
        !Number.isFinite(updated.getTime())
      )
        throw new BadRequestException(
          'Valor, moeda, ambiente ou data do pagamento divergente.',
        );
      if (p.providerPaymentId && p.providerPaymentId !== String(provider.id))
        throw new ConflictException(
          'Esta compra já está vinculada a outro pagamento.',
        );
      if (
        p.providerUpdatedAt &&
        updated.getTime() < new Date(p.providerUpdatedAt).getTime()
      )
        return this.publicPayment(p);
      const reversal =
        ['refunded', 'charged_back'].includes(provider.status) ||
        Number(provider.transaction_amount_refunded) > 0;
      if (reversal && p.creditedAt) {
        await m.query(
          'UPDATE "billing_subscription" SET "held" = true WHERE "userId" = $1',
          [p.userId],
        );
        await this.audit(m, null, p.id, 'payment.review_required', {
          status: provider.status,
        });
        await m.query(
          `UPDATE "billing_payment" SET "status" = 'review_required', "providerUpdatedAt" = $2 WHERE "id" = $1`,
          [p.id, updated],
        );
        return this.publicPayment({ ...p, status: 'review_required' });
      }
      if (p.creditedAt) return this.publicPayment(p); // Never activate or extend twice.
      if (provider.status === 'approved' && !reversal) {
        const balance = account.balance + p.snapshot.creditsPerCycle;
        if (balance > 2147483647)
          throw new ConflictException(
            'Saldo excede o limite. Requer revisão administrativa.',
          );
        const [sub] = await m.query(
          'SELECT * FROM "billing_subscription" WHERE "userId" = $1',
          [p.userId],
        );
        if (sub?.held)
          throw new ForbiddenException(
            'A conta possui um pagamento em revisão.',
          );
        const base =
          sub?.snapshot.id === p.planId
            ? Math.max(Date.now(), new Date(sub.expiresAt).getTime())
            : Date.now();
        const expires = new Date(
          base + p.snapshot.billingPeriodDays * 86400000,
        );
        await m.query(
          'UPDATE "credit_account" SET "balance" = $2 WHERE "userId" = $1',
          [p.userId, balance],
        );
        await m.query(
          'INSERT INTO "credit_ledger" ("userId","requestId","delta","balanceAfter","reason") VALUES ($1,$2,$3,$4,$5)',
          [
            p.userId,
            p.id,
            p.snapshot.creditsPerCycle,
            balance,
            'Pagamento aprovado: ' + p.snapshot.name,
          ],
        );
        await m.query(
          'INSERT INTO "billing_subscription" ("userId","paymentId","snapshot","expiresAt") VALUES ($1,$2,$3,$4) ON CONFLICT ("userId") DO UPDATE SET "paymentId"=EXCLUDED."paymentId", "snapshot"=EXCLUDED."snapshot", "expiresAt"=EXCLUDED."expiresAt"',
          [p.userId, p.id, JSON.stringify(p.snapshot), expires],
        );
        await m.query(
          `UPDATE "billing_payment" SET "status" = 'approved', "creditedAt" = now(), "providerPaymentId" = $2, "providerUpdatedAt" = $3 WHERE "id" = $1`,
          [p.id, String(provider.id), updated],
        );
        await this.audit(m, null, p.id, 'payment.credited', {
          credits: p.snapshot.creditsPerCycle,
          balance,
        });
        return this.publicPayment({
          ...p,
          status: 'approved',
          creditedAt: new Date(),
          providerPaymentId: String(provider.id),
        });
      }
      const status = [
        'pending',
        'in_process',
        'authorized',
        'rejected',
        'cancelled',
        'refunded',
        'charged_back',
      ].includes(provider.status)
        ? provider.status
        : 'pending';
      await m.query(
        'UPDATE "billing_payment" SET "status"=$2,"providerPaymentId"=$3,"providerUpdatedAt"=$4 WHERE "id"=$1',
        [p.id, status, String(provider.id), updated],
      );
      return this.publicPayment({
        ...p,
        status,
        providerPaymentId: String(provider.id),
      });
    });
  }
  async resolveReview(actorId: number, userId: number, reason: string) {
    return this.db.transaction(async (m) => {
      await this.platform.activeUser(actorId, m, true);
      const [target] = await m.query(
        'SELECT "id" FROM "user" WHERE "id" = $1 AND "deletedAt" IS NULL',
        [userId],
      );
      if (!target) throw new NotFoundException('Usuário não encontrado.');
      await this.lockAccount(m, userId);
      await m.query(
        'UPDATE "billing_subscription" SET "held" = false, "expiresAt" = LEAST("expiresAt",now()) WHERE "userId" = $1',
        [userId],
      );
      await m.query(
        `UPDATE "billing_payment" SET "status" = 'review_resolved' WHERE "userId" = $1 AND "status" = 'review_required'`,
        [userId],
      );
      await this.audit(m, actorId, null, 'payment.review_resolved', {
        userId,
        reason,
      });
      return { resolved: true };
    });
  }
}

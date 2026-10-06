import { MigrationInterface, QueryRunner } from 'typeorm';
export class Billing1791325000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
   CREATE TABLE "billing_plan" ("id" varchar(40) PRIMARY KEY, "name" varchar(80) NOT NULL, "description" varchar(400) NOT NULL, "priceCents" integer NOT NULL CHECK ("priceCents" >= 100), "creditsPerCycle" integer NOT NULL CHECK ("creditsPerCycle" > 0), "billingPeriodDays" integer NOT NULL CHECK ("billingPeriodDays" > 0), "maxActiveKeys" integer NOT NULL, "apiRateLimit" integer NOT NULL, "normal" boolean NOT NULL, "freefire" boolean NOT NULL, "consultas" boolean NOT NULL, "active" boolean NOT NULL DEFAULT false, "public" boolean NOT NULL DEFAULT false);
   CREATE TABLE "billing_payment" ("id" uuid PRIMARY KEY, "userId" integer NOT NULL REFERENCES "user"("id") ON DELETE CASCADE, "requestId" uuid NOT NULL, "planId" varchar(40) NOT NULL, "snapshot" jsonb NOT NULL, "status" varchar(30) NOT NULL DEFAULT 'creating', "providerPaymentId" varchar(30) UNIQUE, "checkoutUrl" text, "creditedAt" timestamptz, "providerUpdatedAt" timestamptz, "createdAt" timestamptz NOT NULL DEFAULT now(), UNIQUE ("userId", "requestId"));
   CREATE INDEX "IDX_billing_payment_user" ON "billing_payment" ("userId", "createdAt" DESC);
   CREATE TABLE "billing_subscription" ("userId" integer PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE, "paymentId" uuid NOT NULL REFERENCES "billing_payment"("id"), "snapshot" jsonb NOT NULL, "expiresAt" timestamptz NOT NULL, "held" boolean NOT NULL DEFAULT false);
   CREATE TABLE "billing_audit" ("id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(), "actorId" integer, "paymentId" uuid, "action" varchar(80) NOT NULL, "details" jsonb NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now());
  `);
    // Recover editable examples from v0.15.8, keeping sales disabled until the owner configures payments.
    await q.query(`INSERT INTO "billing_plan" VALUES
   ('starter','Starter','Para bots e automações.',1290,100000,30,5,30,true,true,false,false,false),
   ('pro','Pro','Mais volume e acesso a todas as categorias.',2990,500000,30,10,60,true,true,true,false,false)`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(
      'DROP TABLE "billing_audit", "billing_subscription", "billing_payment", "billing_plan"',
    );
  }
}

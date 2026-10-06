import { MigrationInterface, QueryRunner } from 'typeorm';

export class PlatformFoundation1791323000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "credit_account" (
        "userId" integer PRIMARY KEY REFERENCES "user"("id") ON DELETE CASCADE,
        "balance" integer NOT NULL DEFAULT 0 CHECK ("balance" >= 0)
      );
      CREATE TABLE "api_key" (
        "id" uuid PRIMARY KEY, "userId" integer NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "name" varchar(80) NOT NULL, "prefix" varchar(24) NOT NULL, "hash" varchar(64) UNIQUE NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(), "lastUsedAt" timestamptz, "revokedAt" timestamptz
      );
      CREATE INDEX "IDX_api_key_user" ON "api_key" ("userId");
      CREATE TABLE "credit_ledger" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "userId" integer NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "requestId" uuid NOT NULL, "delta" integer NOT NULL, "balanceAfter" integer NOT NULL CHECK ("balanceAfter" >= 0),
        "reason" varchar(240) NOT NULL, "actorId" integer,
        "createdAt" timestamptz NOT NULL DEFAULT now(), UNIQUE ("userId", "requestId")
      );
      CREATE TABLE "api_usage" (
        "id" uuid PRIMARY KEY, "userId" integer NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "requestId" uuid NOT NULL, "keyId" uuid NOT NULL, "route" varchar(160) NOT NULL,
        "method" varchar(10) NOT NULL, "status" integer NOT NULL, "cost" integer NOT NULL CHECK ("cost" >= 0),
        "createdAt" timestamptz NOT NULL DEFAULT now(), UNIQUE ("userId", "requestId")
      );
      CREATE INDEX "IDX_api_usage_recent" ON "api_usage" ("userId", "createdAt" DESC);
    `);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TABLE "api_usage", "credit_ledger", "api_key", "credit_account"',
    );
  }
}

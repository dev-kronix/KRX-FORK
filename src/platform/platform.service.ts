import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { isUUID } from 'class-validator';
import { AdjustCreditsDto, PaginationDto } from './platform.dto';

export type ApiIdentity = { userId: number; keyId: string };
export type UsageInput = ApiIdentity & {
  requestId: string;
  route: string;
  method: string;
  status: number;
  cost: number;
};
type KeyRecord = {
  id: string;
  name: string;
  prefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};
const publicKeyColumns =
  '"id", "name", "prefix", "createdAt", "lastUsedAt", "revokedAt"';
const MAX_CREDITS = 2147483647;

@Injectable()
export class PlatformService {
  constructor(private readonly db: DataSource) {}

  // Recheck account state in the database; a previously issued JWT can outlive role/status changes.
  async activeUser(
    userId: number,
    manager: EntityManager = this.db.manager,
    admin = false,
  ) {
    const [user] = await manager.query(
      'SELECT "id", "roleId" FROM "user" WHERE "id" = $1 AND "deletedAt" IS NULL AND "statusId" = 1',
      [userId],
    );
    if (!user) throw new ForbiddenException('Conta indisponível ou inativa.');
    if (admin && user.roleId !== 1)
      throw new ForbiddenException('Acesso exclusivo para administradores.');
    return user;
  }

  private async account(userId: number, manager: EntityManager) {
    await manager.query(
      'INSERT INTO "credit_account" ("userId") VALUES ($1) ON CONFLICT DO NOTHING',
      [userId],
    );
    const [account] = await manager.query(
      'SELECT "balance" FROM "credit_account" WHERE "userId" = $1 FOR UPDATE',
      [userId],
    );
    return account as { balance: number };
  }

  private publicKey(key: KeyRecord) {
    return {
      ...key,
      maskedKey: key.prefix + '…',
      status: key.revokedAt ? 'revoked' : 'active',
    };
  }

  async listKeys(userId: number) {
    await this.activeUser(userId);
    const keys: KeyRecord[] = await this.db.query(
      `SELECT ${publicKeyColumns} FROM "api_key" WHERE "userId" = $1 ORDER BY "createdAt" DESC`,
      [userId],
    );
    return keys.map((key) => this.publicKey(key));
  }

  async createKey(userId: number, name: string) {
    return this.db.transaction(async (manager) => {
      await this.activeUser(userId, manager);
      await this.account(userId, manager); // Serializes key creation and the active-key limit.
      const [{ count }] = await manager.query(
        'SELECT count(*)::int AS count FROM "api_key" WHERE "userId" = $1 AND "revokedAt" IS NULL',
        [userId],
      );
      if (count >= 5)
        throw new ConflictException('Limite de cinco chaves ativas atingido.');
      const key = 'krx_live_' + randomBytes(32).toString('hex');
      const [record] = await manager.query(
        `INSERT INTO "api_key" ("id", "userId", "name", "prefix", "hash") VALUES ($1,$2,$3,$4,$5) RETURNING ${publicKeyColumns}`,
        [randomUUID(), userId, name, key.slice(0, 20), this.hash(key)],
      );
      return { key, record: this.publicKey(record) };
    });
  }

  async revokeKey(userId: number, keyId: string) {
    return this.db.transaction(async (manager) => {
      await this.activeUser(userId, manager);
      await this.account(userId, manager);
      const [rows] = await manager.query(
        `UPDATE "api_key" SET "revokedAt" = COALESCE("revokedAt", now()) WHERE "id" = $1 AND "userId" = $2 RETURNING ${publicKeyColumns}`,
        [keyId, userId],
      );
      const key: KeyRecord | undefined = rows[0];
      if (!key) throw new NotFoundException('Chave não encontrada.');
      return this.publicKey(key);
    });
  }

  private hash(key: string) {
    return createHash('sha256').update(key).digest('hex');
  }

  async authenticateKey(rawKey: string): Promise<ApiIdentity> {
    if (!/^krx_live_[a-f0-9]{64}$/.test(rawKey))
      throw new UnauthorizedException('Chave inválida.');
    const [key] = await this.db.query(
      'SELECT k."id", k."userId" FROM "api_key" k JOIN "user" u ON u."id" = k."userId" WHERE k."hash" = $1 AND k."revokedAt" IS NULL AND u."deletedAt" IS NULL AND u."statusId" = 1',
      [this.hash(rawKey)],
    );
    if (!key) throw new UnauthorizedException('Chave inválida ou revogada.');
    return { userId: key.userId, keyId: key.id };
  }

  async summary(userId: number) {
    await this.activeUser(userId);
    const [account] = await this.db.query(
      'SELECT "balance" FROM "credit_account" WHERE "userId" = $1',
      [userId],
    );
    const [usage] = await this.db.query(
      'SELECT count(*)::int AS "totalRequests", COALESCE(sum("cost"), 0)::bigint::text AS "totalSpent", count(*) FILTER (WHERE "status" >= 400)::int AS "failedRequests" FROM "api_usage" WHERE "userId" = $1',
      [userId],
    );
    return {
      balance: account?.balance ?? 0,
      ...usage,
      totalSpent: Number(usage.totalSpent),
    };
  }

  async history(userId: number, pagination: PaginationDto, ledger = false) {
    await this.activeUser(userId);
    const table = ledger ? 'credit_ledger' : 'api_usage';
    const columns = ledger
      ? '"id", "requestId", "delta", "balanceAfter", "reason", "actorId", "createdAt"'
      : '"id", "requestId", "keyId", "route", "method", "status", "cost", "createdAt"';
    const rows = await this.db.query(
      `SELECT ${columns} FROM "${table}" WHERE "userId" = $1 ORDER BY "createdAt" DESC, "id" DESC LIMIT $2 OFFSET $3`,
      [userId, pagination.limit + 1, (pagination.page - 1) * pagination.limit],
    );
    return {
      data: rows.slice(0, pagination.limit),
      hasNextPage: rows.length > pagination.limit,
      page: pagination.page,
    };
  }

  async adjustCredits(
    actorId: number,
    userId: number,
    input: AdjustCreditsDto,
  ) {
    return this.db.transaction(async (manager) => {
      await this.activeUser(actorId, manager, true);
      await this.activeUser(userId, manager);
      const account = await this.account(userId, manager);
      const [existing] = await manager.query(
        'SELECT * FROM "credit_ledger" WHERE "userId" = $1 AND "requestId" = $2',
        [userId, input.requestId],
      );
      if (existing) {
        if (
          existing.delta !== input.delta ||
          existing.reason !== input.reason ||
          existing.actorId !== actorId
        )
          throw new ConflictException(
            'Identificador já utilizado em outra operação.',
          );
        return existing;
      }
      const [usage] = await manager.query(
        'SELECT "id" FROM "api_usage" WHERE "userId" = $1 AND "requestId" = $2',
        [userId, input.requestId],
      );
      if (usage)
        throw new ConflictException(
          'Identificador já utilizado em uma requisição.',
        );
      const balance = account.balance + input.delta;
      if (balance < 0 || balance > MAX_CREDITS)
        throw new BadRequestException(
          'O ajuste ultrapassa os limites do saldo.',
        );
      await manager.query(
        'UPDATE "credit_account" SET "balance" = $2 WHERE "userId" = $1',
        [userId, balance],
      );
      const [entry] = await manager.query(
        'INSERT INTO "credit_ledger" ("userId", "requestId", "delta", "balanceAfter", "reason", "actorId") VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
        [userId, input.requestId, input.delta, balance, input.reason, actorId],
      );
      return entry;
    });
  }

  // Internal integration contract. Never expose client-controlled cost/status as an HTTP debit endpoint.
  // Call only after a successful provider result; failures are recorded with cost zero.
  async recordUsage(input: UsageInput) {
    if (
      !Number.isInteger(input.cost) ||
      input.cost < 0 ||
      input.cost > MAX_CREDITS ||
      !Number.isInteger(input.status) ||
      input.status < 200 ||
      input.status > 599 ||
      !/^[A-Z]{3,10}$/.test(input.method) ||
      !/^\/[a-zA-Z0-9/_:.-]{1,159}$/.test(input.route) ||
      !isUUID(input.requestId)
    )
      throw new BadRequestException('Registro de consumo inválido.');
    const cost = input.status >= 300 ? 0 : input.cost;
    return this.db.transaction(async (manager) => {
      await this.activeUser(input.userId, manager);
      const account = await this.account(input.userId, manager);
      const [key] = await manager.query(
        'SELECT "id" FROM "api_key" WHERE "id" = $1 AND "userId" = $2 AND "revokedAt" IS NULL',
        [input.keyId, input.userId],
      );
      if (!key) throw new UnauthorizedException('Chave inválida ou revogada.');
      const [existing] = await manager.query(
        'SELECT * FROM "api_usage" WHERE "userId" = $1 AND "requestId" = $2',
        [input.userId, input.requestId],
      );
      if (existing) {
        if (
          existing.keyId !== input.keyId ||
          existing.route !== input.route ||
          existing.method !== input.method ||
          existing.status !== input.status ||
          existing.cost !== cost
        )
          throw new ConflictException(
            'Identificador já utilizado em outra operação.',
          );
        return { usage: existing, remainingCredits: account.balance };
      }
      const [adjustment] = await manager.query(
        'SELECT "id" FROM "credit_ledger" WHERE "userId" = $1 AND "requestId" = $2',
        [input.userId, input.requestId],
      );
      if (adjustment)
        throw new ConflictException('Identificador já utilizado em um ajuste.');
      if (account.balance < cost)
        throw new HttpException('Créditos insuficientes.', 402);
      const balance = account.balance - cost;
      await manager.query(
        'UPDATE "credit_account" SET "balance" = $2 WHERE "userId" = $1',
        [input.userId, balance],
      );
      const [usage] = await manager.query(
        'INSERT INTO "api_usage" ("id", "userId", "requestId", "keyId", "route", "method", "status", "cost") VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
        [
          randomUUID(),
          input.userId,
          input.requestId,
          input.keyId,
          input.route,
          input.method,
          input.status,
          cost,
        ],
      );
      if (cost)
        await manager.query(
          'INSERT INTO "credit_ledger" ("userId", "requestId", "delta", "balanceAfter", "reason") VALUES ($1,$2,$3,$4,$5)',
          [
            input.userId,
            input.requestId,
            -cost,
            balance,
            input.method + ' ' + input.route,
          ],
        );
      await manager.query(
        'UPDATE "api_key" SET "lastUsedAt" = now() WHERE "id" = $1',
        [input.keyId],
      );
      return { usage, remainingCredits: balance };
    });
  }
}

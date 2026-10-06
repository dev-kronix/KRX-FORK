import validationOptions from '../utils/validation-options';
import { PGlite } from '@electric-sql/pglite';
import { DataSource, QueryRunner } from 'typeorm';
import { randomUUID } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import request from 'supertest';
import { PlatformService, UsageInput } from './platform.service';
import {
  ApiKeysController,
  UsageController,
  AdminCreditsController,
} from './platform.controller';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { PlatformFoundation1791323000000 } from '../database/migrations/1791323000000-PlatformFoundation';

// PostgreSQL engine in WASM: real SQL, constraints and rollback, with serialized transactions.
// PGlite serializes transactions; this does not simulate native multi-connection contention.
describe('Platform foundation (PostgreSQL)', () => {
  let pg: PGlite;
  let service: PlatformService;
  let app: INestApplication;
  const jwt = new JwtService({ secret: 'phase-one-test-secret' });
  const token = (id = 2, role = 2) =>
    jwt.sign({ id, role: { id: role }, sessionId: 1 });

  beforeAll(async () => {
    pg = new PGlite();
    await pg.exec(`CREATE FUNCTION uuid_generate_v4() RETURNS uuid LANGUAGE SQL AS 'SELECT gen_random_uuid()';
      CREATE TABLE "user" ("id" integer PRIMARY KEY, "roleId" integer, "statusId" integer, "deletedAt" timestamp);
      INSERT INTO "user" VALUES (1,1,1,NULL), (2,2,1,NULL), (3,2,1,NULL), (4,2,2,NULL);`);
    await new PlatformFoundation1791323000000().up({
      query: (sql: string) => pg.exec(sql),
    } as unknown as QueryRunner);
    const raw = (
      sql: string,
      result: { rows: unknown[]; affectedRows?: number },
    ) =>
      /^(UPDATE|DELETE)\b/i.test(sql.trim())
        ? [result.rows, result.affectedRows ?? 0]
        : result.rows;
    const query = async (sql: string, params?: unknown[]) =>
      raw(sql, await pg.query(sql, params));
    const source = {
      query,
      manager: { query },
      transaction: (cb: (manager: unknown) => Promise<unknown>) =>
        pg.transaction((tx) =>
          cb({
            query: async (sql: string, params?: unknown[]) =>
              raw(sql, await tx.query(sql, params)),
          }),
        ),
    } as unknown as DataSource;
    service = new PlatformService(source);
    const module = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [ApiKeysController, UsageController, AdminCreditsController],
      providers: [
        JwtStrategy,
        {
          provide: ConfigService,
          useValue: { getOrThrow: () => 'phase-one-test-secret' },
        },
        { provide: PlatformService, useValue: service },
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
      'TRUNCATE "credit_account", "api_key", "credit_ledger", "api_usage"; UPDATE "user" SET "statusId" = 1, "roleId" = CASE WHEN "id" = 1 THEN 1 ELSE 2 END, "deletedAt" = NULL; UPDATE "user" SET "statusId" = 2 WHERE "id" = 4;',
    );
  });
  afterAll(async () => {
    await app?.close();
    await pg?.close();
  });
  const grant = (delta = 10, requestId: string = randomUUID()) =>
    service.adjustCredits(1, 2, { delta, requestId, reason: 'Teste de saldo' });
  const input = (
    keyId: string,
    overrides: Partial<UsageInput> = {},
  ): UsageInput => ({
    userId: 2,
    keyId,
    requestId: randomUUID(),
    route: '/api/v1/future/service',
    method: 'GET',
    status: 200,
    cost: 4,
    ...overrides,
  });

  it('should requires JWT and returns zero initial balance', async () => {
    await request(app.getHttpServer()).get('/api/v1/usage/summary').expect(401);
    const response = await request(app.getHttpServer())
      .get('/api/v1/usage/summary')
      .auth(token(), { type: 'bearer' })
      .expect(200);
    expect(response.body).toEqual({
      balance: 0,
      totalRequests: 0,
      totalSpent: 0,
      failedRequests: 0,
    });
  });
  it('should creates a key once, stores only the hash, and isolates owners', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/keys')
      .auth(token(), { type: 'bearer' })
      .send({ name: '  Meu bot  ' })
      .expect(201);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.key).toMatch(/^krx_live_[a-f0-9]{64}$/);
    expect(response.body.record.name).toBe('Meu bot');
    const stored = await pg.query('SELECT * FROM "api_key"');
    expect(JSON.stringify(stored.rows)).not.toContain(response.body.key);
    const list = await request(app.getHttpServer())
      .get('/api/v1/keys')
      .auth(token(), { type: 'bearer' })
      .expect(200);
    expect(list.body[0].hash).toBeUndefined();
    expect(list.body[0].key).toBeUndefined();
    await request(app.getHttpServer())
      .delete('/api/v1/keys/' + response.body.record.id)
      .auth(token(3), { type: 'bearer' })
      .expect(404);
    expect(await service.listKeys(3)).toEqual([]);
  });
  it('should enforces five active keys under simultaneous creation', async () => {
    const result = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) => service.createKey(2, 'Bot ' + i)),
    );
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
    expect(
      (await service.listKeys(2)).filter((k) => k.status === 'active'),
    ).toHaveLength(5);
  });
  it('should revocation is idempotent, blocks authentication, and frees a slot', async () => {
    const key = await service.createKey(2, 'Bot');
    expect(await service.authenticateKey(key.key)).toEqual({
      userId: 2,
      keyId: key.record.id,
    });
    const revoked = await service.revokeKey(2, key.record.id);
    expect(revoked).toMatchObject({ id: key.record.id, status: 'revoked' });
    await service.revokeKey(2, key.record.id);
    await expect(service.authenticateKey(key.key)).rejects.toMatchObject({
      status: 401,
    });
    expect((await service.createKey(2, 'Replacement')).record.status).toBe(
      'active',
    );
  });
  it('should validates key names, pagination and IDs at HTTP boundaries', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/keys')
      .auth(token(), { type: 'bearer' })
      .send({ name: '   ' })
      .expect(422);
    await request(app.getHttpServer())
      .get('/api/v1/usage/recent?limit=500')
      .auth(token(), { type: 'bearer' })
      .expect(422);
    await request(app.getHttpServer())
      .delete('/api/v1/keys/not-a-uuid')
      .auth(token(), { type: 'bearer' })
      .expect(400);
  });
  it('should only active current admins can adjust; stale admin JWTs cannot', async () => {
    const payload = { delta: 5, reason: 'Inicial', requestId: randomUUID() };
    await request(app.getHttpServer())
      .post('/api/v1/admin/credits/2/adjustments')
      .auth(token(), { type: 'bearer' })
      .send(payload)
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/admin/credits/2/adjustments')
      .auth(token(1, 1), { type: 'bearer' })
      .send(payload)
      .expect(201);
    await pg.exec('UPDATE "user" SET "roleId" = 2 WHERE "id" = 1');
    await request(app.getHttpServer())
      .post('/api/v1/admin/credits/2/adjustments')
      .auth(token(1, 1), { type: 'bearer' })
      .send({ ...payload, requestId: randomUUID() })
      .expect(403);
  });
  it('should adjustments are auditable and idempotent; changed retries conflict', async () => {
    const id = randomUUID();
    await grant(10, id);
    await grant(10, id);
    expect((await service.summary(2)).balance).toBe(10);
    await expect(grant(20, id)).rejects.toMatchObject({ status: 409 });
    const history = await service.history(2, { page: 1, limit: 20 }, true);
    expect(history.data).toHaveLength(1);
    expect(history.data[0].actorId).toBe(1);
    expect(
      (await service.history(3, { page: 1, limit: 20 }, true)).data,
    ).toEqual([]);
  });
  it('should rejects zero, fractional, overflow and overdraft adjustments', async () => {
    await expect(grant(-1)).rejects.toMatchObject({ status: 400 });
    const url = '/api/v1/admin/credits/2/adjustments';
    for (const delta of [0, 1.5, 2147483648])
      await request(app.getHttpServer())
        .post(url)
        .auth(token(1, 1), { type: 'bearer' })
        .send({ delta, reason: 'Teste', requestId: randomUUID() })
        .expect(422);
    await grant(2147483647);
    await expect(grant(1)).rejects.toMatchObject({ status: 400 });
  });
  it('should charges success exactly once and records failed requests without charge', async () => {
    await grant();
    const key = await service.createKey(2, 'Bot');
    const usage = input(key.record.id);
    await service.recordUsage(usage);
    await service.recordUsage(usage);
    await service.recordUsage(input(key.record.id, { status: 503 }));
    expect(await service.summary(2)).toEqual({
      balance: 6,
      totalRequests: 2,
      totalSpent: 4,
      failedRequests: 1,
    });
    await expect(
      service.recordUsage({ ...usage, cost: 5 }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('should concurrent charges cannot overdraw and rejected charges leave no history', async () => {
    await grant(10);
    const key = await service.createKey(2, 'Bot');
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        service.recordUsage(input(key.record.id)),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect(await service.summary(2)).toMatchObject({
      balance: 2,
      totalRequests: 2,
      totalSpent: 8,
    });
    expect(
      (await service.history(2, { page: 1, limit: 20 }, true)).data,
    ).toHaveLength(3);
  });
  it('should never mixes key owners or reuses adjustment IDs for consumption', async () => {
    await grant();
    const key = await service.createKey(2, 'Bot');
    await expect(
      service.recordUsage(input(key.record.id, { userId: 3 })),
    ).rejects.toMatchObject({ status: 401 });
    const id = randomUUID();
    await grant(2, id);
    await expect(
      service.recordUsage(input(key.record.id, { requestId: id })),
    ).rejects.toMatchObject({ status: 409 });
    const free = input(key.record.id, { cost: 0 });
    await service.recordUsage(free);
    await expect(grant(1, free.requestId)).rejects.toMatchObject({
      status: 409,
    });
  });
  it('should inactive/deleted users cannot manage keys or authenticate existing keys', async () => {
    const key = await service.createKey(2, 'Bot');
    await pg.exec('UPDATE "user" SET "statusId" = 2 WHERE "id" = 2');
    await expect(service.authenticateKey(key.key)).rejects.toMatchObject({
      status: 401,
    });
    await expect(service.listKeys(2)).rejects.toMatchObject({ status: 403 });
    await request(app.getHttpServer())
      .get('/api/v1/usage/summary')
      .auth(token(4), { type: 'bearer' })
      .expect(403);
    await pg.exec(
      'UPDATE "user" SET "statusId" = 1, "deletedAt" = now() WHERE "id" = 2',
    );
    await expect(service.authenticateKey(key.key)).rejects.toMatchObject({
      status: 401,
    });
  });
  it('should paginates histories and rejects logging secrets in query strings', async () => {
    await grant();
    const key = await service.createKey(2, 'Bot');
    for (let i = 0; i < 3; i++)
      await service.recordUsage(input(key.record.id, { cost: 0 }));
    expect(await service.history(2, { page: 1, limit: 2 })).toMatchObject({
      hasNextPage: true,
      page: 1,
    });
    expect((await service.history(2, { page: 2, limit: 2 })).data).toHaveLength(
      1,
    );
    await expect(
      service.recordUsage(
        input(key.record.id, { route: '/api/service?apikey=secret' }),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('should rolls back the balance if a later insert fails', async () => {
    await grant();
    const key = await service.createKey(2, 'Bot');
    await pg.exec(`CREATE FUNCTION reject_test_usage() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test insert failure'; END; $$;
      CREATE TRIGGER reject_test_usage BEFORE INSERT ON "api_usage" FOR EACH ROW EXECUTE FUNCTION reject_test_usage();`);
    try {
      await expect(service.recordUsage(input(key.record.id))).rejects.toThrow(
        'test insert failure',
      );
      expect((await service.summary(2)).balance).toBe(10);
    } finally {
      await pg.exec(
        'DROP TRIGGER reject_test_usage ON "api_usage"; DROP FUNCTION reject_test_usage();',
      );
    }
  });
});

import { PGlite } from '@electric-sql/pglite';
import { DataSource, QueryRunner } from 'typeorm';
import { randomUUID } from 'crypto';
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
import { Support1791327000000 } from '../database/migrations/1791327000000-Support';
import { SupportService } from './support.service';
import {
  SupportController,
  AdminSupportController,
  NotificationsController,
} from './support.controller';

describe('Support and account notifications', () => {
  let pg: PGlite;
  let support: SupportService;
  let app: INestApplication;
  const jwt = new JwtService({ secret: 'support-test-secret' });
  const token = (id = 2, role = 2) =>
    jwt.sign({ id, role: { id: role }, sessionId: 1 });
  beforeAll(async () => {
    pg = new PGlite();
    await pg.exec(
      'CREATE TABLE "user"(id integer PRIMARY KEY,"roleId" integer,"statusId" integer,"deletedAt" timestamp); INSERT INTO "user" VALUES(1,1,1,NULL),(2,2,1,NULL),(3,2,1,NULL);',
    );
    await new Support1791327000000().up({
      query: (sql: string) => pg.exec(sql),
    } as unknown as QueryRunner);
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
    support = new SupportService(db, new PlatformService(db));
    const module = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [
        SupportController,
        AdminSupportController,
        NotificationsController,
      ],
      providers: [
        JwtStrategy,
        {
          provide: ConfigService,
          useValue: { getOrThrow: () => 'support-test-secret' },
        },
        { provide: SupportService, useValue: support },
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
      'TRUNCATE support_ticket CASCADE; UPDATE "user" SET "statusId"=1,"roleId"=CASE WHEN id=1 THEN 1 ELSE 2 END',
    );
  });
  afterAll(async () => {
    await app?.close();
    await pg?.close();
  });
  const create = () =>
    support.create(2, {
      subject: 'Pagamento',
      body: 'Meu pedido',
      requestId: randomUUID(),
    });
  it('should require JWT and validate text, IDs and pagination', async () => {
    await request(app.getHttpServer()).get('/api/v1/support').expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/support')
      .auth(token(), { type: 'bearer' })
      .send({ subject: ' ', body: 'Olá', requestId: randomUUID() })
      .expect(422);
    await request(app.getHttpServer())
      .get('/api/v1/support?limit=51')
      .auth(token(), { type: 'bearer' })
      .expect(422);
    const response = await request(app.getHttpServer())
      .post('/api/v1/support')
      .auth(token(), { type: 'bearer' })
      .send({
        subject: ' Dúvida ',
        body: ' Mensagem ',
        requestId: randomUUID(),
        userId: 3,
      })
      .expect(201);
    expect(response.body).toMatchObject({ userId: 2, subject: 'Dúvida' });
  });
  it('should isolate tickets, replies, status and notifications between accounts', async () => {
    const t = await create();
    expect((await support.list(3, { page: 1, limit: 20 })).total).toBe(0);
    await expect(support.detail(3, t.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      support.reply(3, t.id, { body: 'Intruso', requestId: randomUUID() }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(support.status(3, t.id, 'closed')).rejects.toMatchObject({
      status: 404,
    });
    await support.reply(
      1,
      t.id,
      { body: 'Resposta', requestId: randomUUID() },
      true,
    );
    const result = await support.notifications(2, { page: 1, limit: 20 });
    const n = result.data[0] as { id: string };
    await expect(support.read(3, n.id)).rejects.toMatchObject({ status: 404 });
  });
  it('should retry creation safely and reject reused IDs with changed content', async () => {
    const dto = { subject: 'Teste', body: 'Olá', requestId: randomUUID() };
    const first = await support.create(2, dto);
    const second = await support.create(2, dto);
    expect(second.id).toBe(first.id);
    expect((await support.detail(2, first.id)).messages).toHaveLength(1);
    await expect(
      support.create(2, { ...dto, body: 'Outro' }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('should notify once for a retried admin reply and preserve read time', async () => {
    const t = await create();
    const dto = { body: 'Resolvido', requestId: randomUUID() };
    await support.reply(1, t.id, dto, true);
    await support.reply(1, t.id, dto, true);
    await expect(
      support.reply(1, t.id, { ...dto, body: 'Alterado' }, true),
    ).rejects.toMatchObject({ status: 409 });
    const result = await support.notifications(2, { page: 1, limit: 20 });
    expect(result.unread).toBe(1);
    expect(result.total).toBe(1);
    const id = (result.data[0] as { id: string }).id;
    const a = await support.read(2, id);
    const b = await support.read(2, id);
    expect(b).toEqual(a);
    expect(
      (await support.notifications(2, { page: 1, limit: 20 })).unread,
    ).toBe(0);
    expect((await support.detail(2, t.id)).messages).toHaveLength(2);
  });
  it('should close and reopen tickets without duplicate status notices', async () => {
    const t = await create();
    await support.status(1, t.id, 'closed', true);
    await support.status(1, t.id, 'closed', true);
    await expect(
      support.reply(2, t.id, { body: 'Nova', requestId: randomUUID() }),
    ).rejects.toMatchObject({ status: 409 });
    await support.status(2, t.id, 'open');
    await support.reply(2, t.id, { body: 'Nova', requestId: randomUUID() });
    expect((await support.notifications(2, { page: 1, limit: 20 })).total).toBe(
      1,
    );
  });
  it('should check current admin roles and active accounts independently of JWT claims', async () => {
    const t = await create();
    await request(app.getHttpServer())
      .get('/api/v1/admin/support')
      .auth(token(), { type: 'bearer' })
      .expect(403);
    await pg.exec('UPDATE "user" SET "roleId"=2 WHERE id=1');
    await request(app.getHttpServer())
      .get('/api/v1/admin/support')
      .auth(token(1, 1), { type: 'bearer' })
      .expect(403);
    await pg.exec('UPDATE "user" SET "statusId"=2 WHERE id=2');
    await expect(support.detail(2, t.id)).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      support.notifications(2, { page: 1, limit: 20 }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('should roll back a reply when notification persistence fails', async () => {
    const t = await create();
    await pg.exec(
      `CREATE FUNCTION reject_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'notice unavailable'; END $$; CREATE TRIGGER reject_notice BEFORE INSERT ON account_notification FOR EACH ROW EXECUTE FUNCTION reject_notice();`,
    );
    try {
      await expect(
        support.reply(
          1,
          t.id,
          { body: 'Falha', requestId: randomUUID() },
          true,
        ),
      ).rejects.toThrow('notice unavailable');
      expect((await support.detail(2, t.id)).messages).toHaveLength(1);
    } finally {
      await pg.exec(
        'DROP TRIGGER reject_notice ON account_notification; DROP FUNCTION reject_notice();',
      );
    }
  });
  it('should paginate admin queue and notification history over real data', async () => {
    const a = await create();
    await create();
    await support.reply(
      1,
      a.id,
      { body: 'Resposta', requestId: randomUUID() },
      true,
    );
    await support.status(1, a.id, 'closed', true);
    const list = await support.list(1, { page: 2, limit: 1 }, true);
    expect(list.total).toBe(2);
    expect(list.data).toHaveLength(1);
    const notices = await support.notifications(2, { page: 2, limit: 1 });
    expect(notices.total).toBe(2);
    expect(notices.data).toHaveLength(1);
  });
});

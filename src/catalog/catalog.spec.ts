jest.mock('../database/config/database.config', () => ({
  __esModule: true,
  default: () => ({ isDocumentDatabase: false }),
}));
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { AuthController } from '../auth/auth.controller';
import {
  ApiKeysController,
  UsageController,
} from '../platform/platform.controller';
import { BillingController } from '../billing/billing.controller';
import {
  ForbiddenException,
  INestApplication,
  RequestMethod,
  VersioningType,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PassportModule } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { CatalogService } from './catalog.service';
import {
  CatalogController,
  AdminCatalogController,
} from './catalog.controller';
import { PlatformService } from '../platform/platform.service';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
describe('Implemented catalog', () => {
  const service = new CatalogService();
  const jwt = new JwtService({ secret: 'catalog-test-secret' });
  const platform = { activeUser: jest.fn() };
  let app: INestApplication;
  beforeAll(async () => {
    const m = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [CatalogController, AdminCatalogController],
      providers: [
        { provide: CatalogService, useValue: service },
        { provide: PlatformService, useValue: platform },
        JwtStrategy,
        {
          provide: ConfigService,
          useValue: new ConfigService({
            auth: { secret: 'catalog-test-secret' },
          }),
        },
      ],
    }).compile();
    app = m.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    await app.init();
  });
  beforeEach(() => {
    platform.activeUser.mockReset().mockResolvedValue({ id: 1 });
  });
  afterAll(async () => {
    await app?.close();
  });
  it('should expose exactly eight existing read endpoints in three groups', () => {
    const data = service.catalog().data;
    expect(data.routeCount).toBe(8);
    expect(data.categories).toHaveLength(3);
    const routes = data.categories.flatMap((c) => c.routes);
    expect(new Set(routes.map((r) => r.id)).size).toBe(8);
    expect(
      routes.every(
        (r) => r.source === 'current' && r.executable && r.method === 'GET',
      ),
    ).toBe(true);
    expect(data).not.toHaveProperty('legacyTotal');
    expect(data).not.toHaveProperty('sourceArchive');
    expect(routes.some((r) => /ias|consultas|scraper/.test(r.path))).toBe(
      false,
    );
  });
  it('should publish only GET paths actually declared by current controllers', () => {
    const registered = new Set<string>();
    for (const controller of [
      AuthController,
      ApiKeysController,
      UsageController,
      BillingController,
    ]) {
      const base = Reflect.getMetadata(PATH_METADATA, controller);
      for (const name of Object.getOwnPropertyNames(controller.prototype)) {
        const method = (
          controller.prototype as unknown as Record<string, unknown>
        )[name];
        if (
          typeof method !== 'function' ||
          Reflect.getMetadata(METHOD_METADATA, method) !== RequestMethod.GET
        )
          continue;
        const path = Reflect.getMetadata(PATH_METADATA, method);
        registered.add(
          ('/api/v1/' + base + '/' + path)
            .replace(/\/+/g, '/')
            .replace(/\/$/, ''),
        );
      }
    }
    for (const route of service
      .catalog()
      .data.categories.flatMap((c) => c.routes))
      expect(registered.has(route.path)).toBe(true);
  });
  it('should preserve real pagination parameters', () => {
    const recent = service
      .catalog()
      .data.categories.flatMap((c) => c.routes)
      .find((r) => r.id === 'current-recent')!;
    expect(recent.path).toBe('/api/v1/usage/recent');
    expect(recent.parameters.map((p: any) => p.name)).toEqual([
      'page',
      'limit',
    ]);
  });
  it('should omit administrative contracts publicly and expose only eight current read operations', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/catalog')
      .expect(200);
    const routes = response.body.data.categories.flatMap((c: any) => c.routes);
    expect(
      routes.some((r: any) => r.visibility === 'admin' || r.requiresAdmin),
    ).toBe(false);
    expect(routes.filter((r: any) => r.executable)).toHaveLength(8);
    expect(
      routes
        .filter((r: any) => r.executable)
        .every(
          (r: any) =>
            r.method === 'GET' && r.source === 'current' && r.credits === 0,
        ),
    ).toBe(true);
    expect(response.body.data.routeCount).toBe(routes.length);
  });
  it('should require JWT and an active admin freshly checked in the database', async () => {
    await request(app.getHttpServer()).get('/api/v1/admin/catalog').expect(401);
    const token = (id: number, role: number) =>
      jwt.sign({ id, role: { id: role }, sessionId: 1 });
    await request(app.getHttpServer())
      .get('/api/v1/admin/catalog')
      .auth(token(2, 2), { type: 'bearer' })
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/admin/catalog')
      .auth(token(1, 1), { type: 'bearer' })
      .expect(200);
    expect(platform.activeUser).toHaveBeenCalledWith(1, undefined, true);
    platform.activeUser.mockRejectedValue(new ForbiddenException());
    await request(app.getHttpServer())
      .get('/api/v1/admin/catalog')
      .auth(token(1, 1), { type: 'bearer' })
      .expect(403);
  });
  it('should leave service paths unregistered while exposing the metadata', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/ias/gpt?query=test')
      .expect(404);
    await request(app.getHttpServer())
      .get('/api/v1/consultas/cpf?cpf=12345678909')
      .expect(404);
  });
});

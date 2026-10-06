import {
  ForbiddenException,
  INestApplication,
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
describe('Recovered catalog', () => {
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
  it('should preserve all 219 legacy contracts across 19 categories and mark every one planned', () => {
    const data = service.catalog(true).data;
    expect(data.legacyTotal).toBe(219);
    expect(data.categories).toHaveLength(20);
    expect(data.routeCount).toBe(227);
    const legacy = data.categories.slice(1).flatMap((c) => c.routes);
    expect(new Set(legacy.map((r) => r.id)).size).toBe(219);
    for (const r of legacy) {
      expect(r).toMatchObject({
        source: 'legacy',
        status: 'planned',
        executable: false,
        active: false,
      });
      expect(r.legacyStatus).toBeDefined();
    }
  });
  it('should preserve GPT inputs, cost and result schema instead of inventing responses', () => {
    const gpt = service
      .catalog()
      .data.categories.flatMap((c) => c.routes)
      .find((r) => r.id === 'ias-gpt')!;
    expect(gpt.path).toBe('/api/v1/ias/gpt');
    expect(gpt.credits).toBe(3);
    expect(gpt.parameters[0]).toMatchObject({
      name: 'query',
      in: 'query',
      required: true,
    });
    expect(gpt.documentation.resultPath).toBe('data.resposta');
    expect(
      gpt.documentation.responseSchema.properties.data.properties.resposta.type,
    ).toBe('string');
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

import { Injectable } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
export type ContractRoute = {
  id: string;
  name: string;
  method: string;
  path: string;
  auth: string;
  credits: number;
  status: string;
  visibility?: string;
  requiresAdmin?: boolean;
  [key: string]: any;
};
type Category = {
  id: string;
  name: string;
  description: string;
  order: number;
  routes: ContractRoute[];
};
type Legacy = {
  sourceArchive: string;
  sourceSha256: string;
  categories: Category[];
};
const currentRoutes: ContractRoute[] = [
  ['current-account', 'Minha conta', '/api/v1/auth/me', 'session'],
  ['current-keys', 'Minhas chaves', '/api/v1/keys', 'session'],
  ['current-usage', 'Saldo e consumo', '/api/v1/usage/summary', 'session'],
  ['current-recent', 'Requisições recentes', '/api/v1/usage/recent', 'session'],
  ['current-ledger', 'Extrato de créditos', '/api/v1/usage/ledger', 'session'],
  ['current-plans', 'Planos disponíveis', '/api/v1/billing/plans', 'none'],
  [
    'current-subscription',
    'Meu plano',
    '/api/v1/billing/subscription',
    'session',
  ],
  [
    'current-payments',
    'Meus pagamentos',
    '/api/v1/billing/payments',
    'session',
  ],
].map(([id, name, path, auth]) => ({
  id,
  name,
  path,
  auth,
  method: 'GET',
  credits: 0,
  status: 'available',
  executable: true,
  source: 'current',
  summary: name,
  description: 'Endpoint de leitura da plataforma atual.',
  contentType: 'application/json',
  body: null,
  errors: [],
  responses: [],
  documentation: {
    notes: [
      'Retorna o contrato atual da plataforma NestJS. Não utiliza o envelope de serviços do legado.',
    ],
  },
  parameters: /\/(recent|ledger|payments)$/.test(path)
    ? [
        {
          name: 'page',
          in: 'query',
          type: 'integer',
          required: false,
          example: '1',
          description: 'Página, a partir de 1.',
        },
        {
          name: 'limit',
          in: 'query',
          type: 'integer',
          required: false,
          example: '20',
          description: 'Itens por página, de 1 a 100.',
        },
      ]
    : [],
}));
@Injectable()
export class CatalogService {
  private readonly legacy: Legacy;
  constructor() {
    this.legacy = JSON.parse(
      readFileSync(join(__dirname, 'contracts/legacy.json'), 'utf8'),
    );
    const ids = new Set<string>(currentRoutes.map((r) => r.id));
    for (const c of this.legacy.categories)
      for (const r of c.routes) {
        if (
          ids.has(r.id) ||
          !r.path.startsWith('/api/') ||
          !['GET', 'POST', 'PATCH', 'DELETE', 'PUT'].includes(r.method) ||
          !['none', 'session', 'apiKey'].includes(r.auth)
        )
          throw new Error('Contrato legado inválido: ' + r.id);
        ids.add(r.id);
      }
  }
  catalog(admin = false) {
    const categories = this.legacy.categories
      .map((category) => ({
        ...category,
        accessGroup:
          category.id === 'free-fire'
            ? 'freefire'
            : category.id === 'consultas'
              ? 'consultas'
              : 'normal',
        routes: category.routes
          .filter(
            (r) => admin || (r.visibility !== 'admin' && !r.requiresAdmin),
          )
          .map((r) => ({
            ...r,
            legacyStatus: r.status,
            status: 'planned',
            active: false,
            executable: false,
            source: 'legacy',
          })),
      }))
      .filter((c) => c.routes.length);
    return {
      success: true,
      status: 200,
      data: {
        version: 'platform-3',
        sourceArchive: this.legacy.sourceArchive,
        sourceSha256: this.legacy.sourceSha256,
        legacyTotal: this.legacy.categories.reduce(
          (n, c) => n + c.routes.length,
          0,
        ),
        routeCount: categories.reduce(
          (n, c) => n + c.routes.length,
          currentRoutes.length,
        ),
        categories: [
          {
            id: 'platform',
            name: 'Plataforma atual',
            description: 'Leituras disponíveis na nova KRX.',
            order: 0,
            accessGroup: 'normal',
            routes: currentRoutes,
          },
          ...categories,
        ],
      },
    };
  }
}

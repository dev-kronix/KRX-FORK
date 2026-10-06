import { Injectable } from '@nestjs/common';
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
const details: Record<
  string,
  { description: string; fields: [string, string][] }
> = {
  'current-account': {
    description:
      'Consulte os dados da conta autenticada, incluindo nome, e-mail, papel e estado.',
    fields: [
      ['id', 'Identificador da conta.'],
      ['email', 'E-mail da conta.'],
      ['firstName', 'Nome do usuário.'],
      ['role', 'Papel da conta.'],
      ['status', 'Estado cadastral.'],
    ],
  },
  'current-keys': {
    description:
      'Liste suas chaves, prefixos, estado e datas de uso. A chave completa não é retornada.',
    fields: [
      ['[].maskedKey', 'Prefixo mascarado da chave.'],
      ['[].status', 'Estado: active ou revoked.'],
      ['[].lastUsedAt', 'Data do último uso, ou null.'],
    ],
  },
  'current-usage': {
    description:
      'Consulte saldo disponível, número de requisições registradas e créditos consumidos.',
    fields: [
      ['balance', 'Saldo de créditos.'],
      ['totalRequests', 'Requisições registradas.'],
      ['totalSpent', 'Créditos consumidos.'],
    ],
  },
  'current-recent': {
    description:
      'Consulte suas requisições registradas, com método, rota, estado HTTP, custo e data.',
    fields: [
      ['data', 'Requisições desta página.'],
      ['hasNextPage', 'Indica se existe outra página.'],
      ['page', 'Página atual.'],
    ],
  },
  'current-ledger': {
    description:
      'Acompanhe cada entrada ou saída de créditos, o motivo e o saldo após a movimentação.',
    fields: [
      [
        'data',
        'Movimentações desta página: delta, balanceAfter, reason e createdAt.',
      ],
      ['hasNextPage', 'Indica se existe outra página.'],
      ['page', 'Página atual.'],
    ],
  },
  'current-plans': {
    description:
      'Consulte os planos que foram ativados e publicados, e a configuração de disponibilidade dos pagamentos.',
    fields: [
      ['plans', 'Planos ativos e públicos. Pode ser uma lista vazia.'],
      [
        'payments.enabled',
        'Indica se as credenciais do checkout estão configuradas.',
      ],
      ['payments.sandbox', 'Indica ambiente de testes.'],
    ],
  },
  'current-subscription': {
    description:
      'Consulte seu plano, validade e estado: gratuito, ativo, expirado ou em revisão.',
    fields: [
      ['plan', 'Condições da assinatura, ou null.'],
      ['expiresAt', 'Vencimento, ou null.'],
      ['status', 'free, active, expired ou review_required.'],
    ],
  },
  'current-payments': {
    description:
      'Liste as compras da sua conta com valor, plano, status e confirmação do crédito.',
    fields: [
      ['data', 'Pagamentos desta página.'],
      ['hasNextPage', 'Indica se existe outra página.'],
      ['page', 'Página atual.'],
    ],
  },
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
  description: details[id].description,
  contentType: 'application/json',
  body: null,
  errors:
    auth === 'session'
      ? [
          { status: 401, description: 'Sessão ausente ou inválida.' },
          {
            status: 403,
            description: 'Conta sem permissão para esta leitura.',
          },
        ]
      : [],
  responses: [{ status: 200, description: details[id].description }],
  documentation: {
    fields: details[id].fields.map(([name, description]) => ({
      name,
      description,
    })),
    notes: ['A resposta é real e usa o formato do endpoint selecionado.'],
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
  catalog() {
    const groups = [
      {
        id: 'account',
        name: 'Conta e chaves',
        description: 'Sua identidade e suas credenciais de acesso.',
        ids: ['current-account', 'current-keys'],
      },
      {
        id: 'usage',
        name: 'Créditos e consumo',
        description: 'Saldo, requisições registradas e movimentações reais.',
        ids: ['current-usage', 'current-recent', 'current-ledger'],
      },
      {
        id: 'billing',
        name: 'Planos e pagamentos',
        description: 'Catálogo de planos, assinatura e compras da sua conta.',
        ids: ['current-plans', 'current-subscription', 'current-payments'],
      },
    ];
    return {
      success: true,
      status: 200,
      data: {
        version: 'platform-4',
        routeCount: currentRoutes.length,
        categories: groups.map((g, order) => ({
          id: g.id,
          name: g.name,
          description: g.description,
          order,
          routes: currentRoutes.filter((r) => g.ids.includes(r.id)),
        })),
      },
    };
  }
}

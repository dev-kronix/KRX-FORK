# KRX API

Backend REST oficial da **KRX**, construído com NestJS e TypeScript.

## Domínios

- Site: `https://krxdev.tech`
- API: `https://krxdev.tech`
- Documentação Swagger: `https://krxdev.tech/docs`
- Prefixo padrão da API: `/api`
- Versionamento atual: `/v1`

Exemplo: `https://krxdev.tech/api/v1/auth/me`.

## Stack

- Node.js 24
- TypeScript
- NestJS 11
- PostgreSQL + TypeORM
- JWT + refresh token
- Sessões
- Autenticação por e-mail
- Confirmação de e-mail
- Recuperação de senha
- Roles e autorização
- Login social com Google
- Upload local e Amazon S3
- I18N com **pt-BR como idioma padrão**
- Swagger / OpenAPI
- Jest + testes E2E
- Docker
- GitHub Actions

## Desenvolvimento local

### Requisitos

- Node.js 24+
- npm 11+
- Docker e Docker Compose

### Instalação

```bash
git clone https://github.com/dev-kronix/KRX-FORK.git
cd KRX-FORK

cp env-example-relational .env
npm install
```

Suba os serviços definidos pelo projeto e inicie a API:

```bash
npm run migration:run
npm run seed:run:relational
npm run start:dev
```

Por padrão:

- API local: `http://localhost:3001`
- Swagger local: `http://localhost:3001/docs`

## Produção

Use `env-example-production` como referência para a VPS:

```bash
cp env-example-production .env
```

Antes de subir, substitua todos os valores `CHANGE_ME_*` e configure banco, SMTP, storage e credenciais do Google de forma segura.

Os domínios oficiais esperados são:

```env
FRONTEND_DOMAIN=https://krxdev.tech
BACKEND_DOMAIN=https://krxdev.tech
APP_CORS_ORIGINS=https://krxdev.tech,https://www.krxdev.tech
```

## Rotas principais existentes

### Autenticação

- `POST /api/v1/auth/email/login`
- `POST /api/v1/auth/email/register`
- `POST /api/v1/auth/email/confirm`
- `POST /api/v1/auth/forgot/password`
- `POST /api/v1/auth/reset/password`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`
- `PATCH /api/v1/auth/me`
- `DELETE /api/v1/auth/me`

### Usuários

As rotas de administração de usuários exigem JWT e role de administrador.

- `POST /api/v1/users`
- `GET /api/v1/users`
- `GET /api/v1/users/:id`
- `PATCH /api/v1/users/:id`
- `DELETE /api/v1/users/:id`

## Banco de dados

O projeto principal da KRX utiliza PostgreSQL/TypeORM.

Comandos úteis:

```bash
npm run migration:create
npm run migration:generate
npm run migration:run
npm run migration:revert
npm run seed:run:relational
```

## Testes e qualidade

```bash
npm run lint
npm test
npm run test:e2e
npm run test:cov
```

## Idioma

O idioma padrão da aplicação é `pt-BR` e o header padrão para seleção de idioma é `Accept-Language`.

Exemplo:

```http
Accept-Language: pt-BR
```

## Licença e origem

Este projeto é distribuído sob licença MIT e foi inicialmente derivado do projeto open source [brocoders/nestjs-boilerplate](https://github.com/brocoders/nestjs-boilerplate). A partir deste fork, configuração, identidade, documentação e evolução funcional são mantidas como parte da KRX.

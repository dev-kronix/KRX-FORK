# Instruções do projeto KRX

A KRX API é uma API REST em NestJS/TypeScript.

## Persistência oficial

O banco oficial do projeto é PostgreSQL com TypeORM. A base herdada ainda contém suporte a MongoDB/Mongoose, mas novas funcionalidades da KRX devem usar a variante relacional, salvo decisão explícita em contrário.

## Ao adicionar recursos, entidades ou propriedades

Prefira os geradores relacionais existentes quando eles fizerem sentido:

- `npm run generate:resource:relational`
- `npm run add:property:to-relational`
- `npm run seed:create:relational`

Depois de alterar entidades, gere e revise a migration antes de executá-la.

## Convenções

- Código e nomes técnicos podem permanecer em inglês quando isso melhorar interoperabilidade.
- Documentação, mensagens ao usuário e conteúdo funcional da KRX devem ser escritos em português do Brasil.
- O idioma padrão da API é `pt-BR`.
- O site oficial é `https://krxdev.tech`.
- A API oficial é `https://api.krxdev.tech`.
- Novas rotas devem manter o versionamento existente em `/api/v1`.
- Não coloque segredos, tokens ou credenciais reais no repositório.

# Plataforma KRX — primeira etapa

Esta etapa adiciona chaves de API, saldo, consumo e movimentações à base NestJS/PostgreSQL. Planos, pagamentos, integrações, catálogo/playground, suporte e Scraper Labs continuam nas próximas etapas. Nenhuma rota de consultas, downloads ou IA foi habilitada.

## Publicação no Coolify

1. Atualize para o commit desta etapa e reconstrua a imagem.
2. Mantenha `DATABASE_SYNCHRONIZE=false` em produção.
3. Execute `npm run migration:run` antes de iniciar o novo backend. O Dockerfile atual usa `startup.relational.dev.sh`, que já executa migrações antes de `start:prod`.
4. Abra `/dashboard/`. Admins têm a aba **Créditos**; contas comuns têm **Chaves** e **Consumo**.

Não são necessárias novas variáveis. As variáveis existentes de PostgreSQL, JWT, SMTP, `FRONTEND_DOMAIN` e Google continuam válidas. Use `FRONTEND_DOMAIN=https://krxdev.tech` para os e-mails apontarem para o dashboard da KRX.

A migração `1791323000000-PlatformFoundation` cria somente quatro tabelas novas; não importa dados de SQLite/JSON, não substitui usuários e não concede créditos automaticamente. O saldo inicial é **zero**. A plataforma desta etapa usa PostgreSQL; o modo MongoDB legado não registra estes controllers.

## Contratos HTTP

As rotas do painel usam JWT em `Authorization: Bearer TOKEN`, seguindo o formato direto da API NestJS atual.

| Método | Caminho | Operação |
|---|---|---|
| GET | `/api/v1/keys` | Listar as próprias chaves mascaradas |
| POST | `/api/v1/keys` | Criar chave: `{ "name": "Meu bot" }` |
| DELETE | `/api/v1/keys/:id` | Revogar a própria chave; repetição é segura |
| GET | `/api/v1/usage/summary` | Saldo, requisições, créditos consumidos e falhas |
| GET | `/api/v1/usage/recent?page=1&limit=20` | Consumo paginado |
| GET | `/api/v1/usage/ledger?page=1&limit=20` | Movimentações de saldo paginadas |
| POST | `/api/v1/admin/credits/:userId/adjustments` | Ajuste administrativo com auditoria e idempotência |

Criação retorna `{ "key": "krx_live_…", "record": { ... } }`. A chave completa aparece **somente na criação**, com `Cache-Control: no-store`. O banco armazena SHA-256, não a chave completa. Essa etapa não recupera a função antiga de revelar chaves criptografadas. Há até cinco chaves ativas por conta, sem expiração automática; revogar libera uma vaga. Uma chave revogada, conta inativa ou excluída deixa de autenticar.

Ajustes exigem `delta` inteiro diferente de zero, `reason` com até 240 caracteres e `requestId` UUID. Delta positivo adiciona; negativo retira. O saldo fica entre 0 e 2.147.483.647. A mesma combinação de usuário/requestId retorna a movimentação original quando o conteúdo e o administrador coincidem; divergências retornam 409. Exemplo:

```json
{
  "delta": 100,
  "reason": "Crédito inicial autorizado",
  "requestId": "885d9cda-ab1e-49b8-a0c1-b94c4f3a26f4"
}
```

Históricos retornam `{ "data": [], "hasNextPage": false, "page": 1 }`, com limite máximo de 50. Operações sem JWT retornam 401. Contas inativas e administradores sem a função atual no banco retornam 403. Recursos de outra conta não são expostos.

A etapa seguinte de planos e pagamentos está documentada no [guia da segunda etapa](PLATFORM-PHASE-2.md).

## Integrações futuras

`PlatformModule` exporta `ApiKeyGuard` e `PlatformService`. O guard aceita apenas o header `x-api-key` e define `request.apiIdentity = { userId, keyId }`. Chaves na URL/corpo não são aceitas.

O método interno `recordUsage` recebe `{ userId, keyId, requestId, route, method, status, cost }`. Não existe endpoint público de débito e o cliente nunca define preço ou resultado da cobrança. `route` deve ser o caminho canônico, sem query strings ou dados pessoais. `status` deve refletir o resultado lógico da operação; uma falha encapsulada em HTTP 200 precisa ser registrada com seu status de falha.

Resultados 2xx descontam o custo informado pelo backend. Outros resultados registram custo zero. Cada consumo tem UUID idempotente: saldo, movimentação, histórico e último uso da chave são gravados na mesma transação, com bloqueio da conta. Saldo insuficiente retorna 402 e não grava consumo nem débito. Repetir um consumo existente retorna o consumo original e o saldo **atual** da conta.

Este método liquida o consumo após o resultado do provedor. Ainda não reserva saldo antes de chamadas externas. Ao habilitar serviços, o fluxo deverá definir reserva/pré-validação e idempotência da chamada ao provedor: a idempotência atual impede cobrança duplicada, não execução externa duplicada. Não habilitar endpoints de teste pagos para simular serviços ausentes.

## E-mail e senha

E-mails novos apontam para `/dashboard/#/confirm-email`, `#/confirm-new-email` e `#/reset-password`, com o token no fragmento. Links antigos `/confirm-email?hash=…`, `/confirm-new-email?hash=…` e `/password-change?hash=…` redirecionam para as novas telas. A confirmação exige um clique, para leitores automáticos de e-mail não consumirem o link.

A redefinição verifica senhas coincidentes e envia `{ hash, password }` ao endpoint existente. Após sucesso o token sai da URL. A troca de senha captura o formulário antes do `await`, evitando acesso a `event.currentTarget` já limpo.

## Validação

```bash
npm ci
npm run build
npm test -- --runInBand
npm run test:dashboard
```

Os testes de backend usam o motor PostgreSQL via PGlite, JWT real, controllers NestJS e supertest; cobrem propriedade das chaves, revogação, limites, contas inativas, função admin atual, créditos, idempotência, paginação e rollback. PGlite serializa transações; os testes concorrentes validam o resultado, mas não substituem uma carga com múltiplas conexões de PostgreSQL nativo. Jest usa `--experimental-vm-modules` para carregar o runtime WASM dessa dependência de desenvolvimento.

Os testes de UI executam o JavaScript real em JSDOM com respostas HTTP controladas. Não validam layout em navegador, SMTP real nem login Google ao vivo. Há também testes dos links efetivamente produzidos pelo mailer.

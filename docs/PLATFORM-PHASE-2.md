# Etapa 2: planos e pagamentos

Esta etapa acrescenta catálogo, compras avulsas pelo Mercado Pago Checkout Pro, confirmação de pagamentos, validade de planos, histórico e administração. As rotas das integrações continuam para a etapa final. Não há cobrança recorrente nesta implementação.

## Coolify

1. Integre esta alteração e faça o build normal do projeto.
2. Execute `npm run migration:run` usando as variáveis do PostgreSQL da aplicação. Use `DATABASE_SYNCHRONIZE=false` em produção. A migração acrescenta quatro tabelas sem importar contas ou transações antigas.
3. Configure os domínios HTTPS já existentes: `BACKEND_DOMAIN` e `FRONTEND_DOMAIN`. Ambos podem ser `https://krxdev.tech` quando o dashboard e a API compartilham o domínio.
4. Configure `MERCADO_PAGO_ACCESS_TOKEN` e `MERCADO_PAGO_WEBHOOK_SECRET` como segredos no Coolify. Nunca coloque credenciais no GitHub ou no dashboard. Reinicie/reimplante a aplicação após mudar as variáveis.
5. Comece com `MERCADO_PAGO_SANDBOX=true`, credenciais e contas de teste do Mercado Pago. Configure notificações de **pagamentos** por Webhooks na aplicação do Mercado Pago, para `https://krxdev.tech/api/v1/billing/webhooks/mercadopago`, e copie a assinatura secreta para a variável acima.
6. Em `/dashboard/#/billing-admin`, revise preço, créditos, dias e limites. Marque **Ativo** e **Visível no catálogo** para disponibilizar cada plano.
7. Confira o checkout no ambiente de teste, seu retorno, o webhook, o extrato e os limites de chaves. Para produção, troque o token e a assinatura pelos da aplicação de produção e defina `MERCADO_PAGO_SANDBOX=false`.

Sem token ou assinatura, o checkout retorna 503 e a interface informa que os pagamentos não estão configurados. O endpoint de notificações precisa ser alcançável pelo Mercado Pago; não coloque autenticação JWT ou uma página de login à frente dele.

A migração recupera os exemplos Starter (R$ 12,90 / 100.000 créditos / 30 dias) e Pro (R$ 29,90 / 500.000 créditos / 30 dias) do código antigo. Eles começam desativados e privados. Não são uma decisão de preço para a nova operação.

## Contratos

Todos os caminhos abaixo usam o prefixo `/api/v1`. Os endpoints administrativos exigem administrador ativo consultado no banco, além de JWT.

| Método e caminho | Acesso | Uso |
| --- | --- | --- |
| `GET /billing/plans` | Público | Planos ativos/públicos e disponibilidade/ambiente do checkout |
| `GET /billing/subscription` | JWT | Plano, validade e estado da própria conta |
| `POST /billing/checkout` | JWT | `{planId, requestId}`; UUID por compra; preço definido no servidor |
| `GET /billing/payments?page=1&limit=20` | JWT | Histórico da própria conta |
| `POST /billing/payments/:id/reconcile` | JWT | `{providerPaymentId}`; consulta a compra do usuário no provedor |
| `POST /billing/webhooks/mercadopago?data.id=…` | HMAC do provedor | Consulta o pagamento e aplica seu estado real |
| `GET /admin/billing/plans` | Admin | Todos os planos, incluindo desativados e privados |
| `POST /admin/billing/plans` | Admin | Cria/atualiza plano com todos os campos do formulário |
| `GET /admin/billing/payments?page=1&limit=20` | Admin | Histórico de todas as contas |
| `POST /admin/billing/payments/:id/reconcile` | Admin | Consulta um pagamento no Mercado Pago |
| `POST /admin/billing/reviews/:userId/resolve` | Admin | `{reason}`; registra a decisão, encerra revisão e expira o plano |

Cada compra guarda as condições do plano no momento do checkout. Alterar um plano não muda compras já criadas. Preço recebido do navegador é descartado. `requestId` repetido para o mesmo usuário/plano recupera a compra; outro plano com o mesmo UUID retorna 409. O dashboard mantém esse UUID quando uma tentativa falha. **Preparar outra compra** permite iniciar um checkout separado após consultar o histórico.

Em timeout ou erro do provedor, a compra permanece registrada como `checkout_error`. Repetir seu UUID não cria outra preferência de pagamento. Revise o histórico antes de iniciar outra compra. Checkouts expiram em duas horas; isso não concede créditos nem cancela pagamentos já feitos.

## Confirmação, créditos e validade

A assinatura HMAC é validada usando `data.id`, `x-request-id` e `x-signature`. Depois, o servidor consulta `GET /v1/payments/:id` e verifica identificador, referência da compra, valor, BRL, ambiente de teste/produção e data. O corpo do webhook e o status na URL de retorno não concedem créditos. A URL de retorno é removida do navegador e a reconciliação exige sessão autenticada e propriedade da compra.

Aprovação, saldo, extrato, assinatura do plano e auditoria são gravados numa única transação. Retentativas não concedem crédito nem estendem validade duas vezes. Atualizações antigas são ignoradas. Um pagamento do provedor não pode ser reutilizado por outra compra.

Comprar o mesmo plano ativo estende a validade a partir do vencimento. Mudar de plano inicia a nova validade a partir da confirmação. Cada compra concede seu lote de créditos. Após o vencimento, os créditos restantes continuam disponíveis, mas os direitos voltam ao acesso gratuito. O limite de criação de chaves é aplicado imediatamente; chaves acima do limite depois de expirar um plano não são revogadas automaticamente. O usuário deve revogar chaves para criar novas.

Categorias (`normal`, `freefire`, `consultas`) e `apiRateLimit` permanecem como metadata no backend e não são apresentados como funcionalidades disponíveis no editor de planos. Esta etapa ainda não aplica rate limiting ou autorizações por categoria às rotas de serviços. Contas gratuitas seguem com limite de cinco chaves e saldo inicial zero.

## Estornos e contestações

Se um pagamento já creditado for reembolsado, parcialmente estornado ou contestado, a conta entra em revisão. Autenticação por chave, novas chaves, consumo e novos checkouts ficam bloqueados. Login, histórico e administração continuam acessíveis.

O sistema não debita automaticamente créditos que podem já ter sido gastos. O administrador consulta o pagamento, faz os ajustes necessários em **Créditos**, com motivo, e encerra a revisão em **Pagamentos**. O encerramento expira o plano, libera o acesso gratuito e mantém a auditoria. Notificações repetidas da compra encerrada não reativam seus benefícios nem recriam a revisão.

## Validação e limites

```bash
npm run build
npm run lint
npm test -- --runInBand
npm run test:dashboard
```

Os testes usam PostgreSQL via PGlite, JWT real nos controllers e provedor simulado. Cobrem propriedade, papel administrativo, valores adulterados, concorrência/idempotência, rollback, expiração, limites de chaves, estornos, HMAC, contrato de checkout e interface DOM. Eles não substituem um teste com a conta de teste do dono no Mercado Pago. Nenhuma credencial ou cobrança real foi usada no desenvolvimento.

Referências oficiais: [Checkout Pro](https://www.mercadopago.com.br/developers/en/reference/online-payments/checkout-pro-preferences/create-preference/post) e [notificações de pagamentos](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/payment-notifications).

# Etapa 3: catálogo e playground

Recupera os contratos do arquivo `KRX-API-v0.15.8.zip`, sem montar as rotas de serviços. Pagamentos continuam configurados conforme a [etapa 2](PLATFORM-PHASE-2.md).

## Uso

- Catálogo: `/dashboard/#/catalog`.
- Playground: `/dashboard/#/playground`.
- Link direto de contrato: `/dashboard/#/playground?route=ias-gpt`.
- Sem sessão, o dashboard solicita login e retorna ao contrato selecionado depois de autenticar, inclusive pelo Google.
- Busque por nome, caminho, descrição ou categoria. Os contratos administrativos antigos só aparecem para administradores.
- Preencha parâmetros e corpo JSON, escolha cURL, JavaScript, TypeScript ou Python e copie o exemplo. Exemplos usam o domínio em que o dashboard está aberto e placeholders de credenciais.
- Contratos antigos indicam **aguardando migração**, com execução bloqueada. Custos, requisitos e formatos exibidos são os do legado; não representam serviços já disponíveis na nova API.
- Leituras da plataforma atual podem ser executadas com a própria sessão. Requisições públicas não recebem JWT. Resultado da execução e contrato documentado aparecem em áreas separadas.

## Inventário recuperado

São 219 contratos em 19 categorias no arquivo de catálogo antigo. Esse número vem dos JSONs de categorias, não da contagem de caminhos no OpenAPI antigo: um mesmo caminho pode representar várias operações e o documento também utiliza uma representação diferente para parâmetros de caminho.

| Categoria | Contratos |
| --- | ---: |
| Sistema | 5 |
| Acesso | 8 |
| Chaves | 3 |
| Consumo | 2 |
| Portal | 4 |
| Downloads | 25 |
| Free Fire | 5 |
| Uploads | 1 |
| Pesquisas | 10 |
| Consultas | 37 |
| Outros | 16 |
| IAs | 6 |
| Logos | 53 |
| Notícias | 7 |
| Stickers | 13 |
| Canvas | 12 |
| Geradores | 2 |
| Animes | 2 |
| Scraper Labs | 8 |

O arquivo `src/catalog/contracts/legacy.json` conserva identificadores, métodos, caminhos, autenticação, parâmetros, corpos, respostas, schemas, erros e documentação. Inclui o SHA-256 do ZIP de origem. Uma observação foi acrescentada ao contrato de revelar chave, explicando a mudança abaixo. Nenhum `.env`, segredo, usuário ou transação do ZIP foi importado.

O catálogo público exibe 197 contratos antigos mais oito leituras atuais, totalizando 205 entradas em 16 categorias. Para administrador são 219 contratos antigos mais oito atuais, totalizando 227 entradas em 20 categorias. Categorias administrativas vazias são omitidas da versão pública.

## Endpoints do catálogo

| Método e caminho | Acesso | Resultado |
| --- | --- | --- |
| `GET /api/v1/catalog` | Público | Envelope `{success,status,data}` com categorias e contratos públicos |
| `GET /api/v1/admin/catalog` | JWT de administrador ativo | Todos os contratos, com papel e estado conferidos no banco |

Cada contrato antigo recebe `source=legacy`, `legacyStatus` preservado, `status=planned`, `active=false` e `executable=false`. Os contratos atuais têm `source=current` e `executable=true`. O JSON de contratos é incluído no build pelo `nest-cli.json`; não requer nova migração nem variável de ambiente.

## Leituras executáveis

São GET de conta (`auth/me`), chaves (`keys`), saldo (`usage/summary`), requisições (`usage/recent`), extrato (`usage/ledger`), planos (`billing/plans`), assinatura (`billing/subscription`) e pagamentos (`billing/payments`). Todas usam `/api/v1/`.

A interface admite somente esses caminhos no mesmo domínio, sem redirecionamentos, sem escrita e sem proxy para provedores. Cada endpoint continua validando sua própria autenticação/propriedade. A leitura pode ser cancelada, tem timeout de 30 segundos e limite de resposta de 1 MiB. Erros HTTP, falhas lógicas (`success=false`) e texto não JSON aparecem como resultado real, sem execução de HTML recebido.

## Diferenças de autenticação

A nova KRX guarda somente o hash das chaves e exibe a chave completa uma vez, ao criá-la. Por isso, o contrato antigo `keys-reveal` é documentação histórica e não será reativado nesse modelo. O playground não tenta reconstruir ou baixar uma chave completa existente.

Leituras atuais usam automaticamente o JWT da conta. Nos exemplos copiáveis, JWT e API key sempre são placeholders; valores reais da sessão não são incorporados. O uso de API key para executar serviços será conectado quando as integrações forem migradas. Esta etapa não cria chaves, não consulta provedores e não debita créditos para simular testes.

## Integrações seguintes

A classificação prepara a migração por categoria: Free Fire usa o grupo `freefire`, Consultas usa `consultas`, e as demais categorias usam `normal`. Isso é metadata do catálogo, não enforcement de acesso ou de rate limit nesta etapa. Suporte, notificações e a implementação de Scraper Labs continuam no roteiro. Os contratos dessas funções já podem ser consultados quando presentes no legado.

## Validação

```bash
npm run build
npm run lint
npm test -- --runInBand
npm run test:dashboard
```

Os testes de catálogo verificam contagem, preservação de campos, ocultação de contratos administrativos, JWT/administrador e ausência de rotas de serviço. Testes de helpers validam sintaxe de JavaScript e Python dos exemplos dos 219 contratos, parâmetros, corpo JSON, multipart e arquivos binários. Os testes DOM exercitam busca, seleção, login com retorno, bloqueio de execução legada, sessão, destino, cancelamento, limites de resposta e resultados de erro.

A validação desta etapa usa HTTP local nos controllers e DOM simulado. Não foi usado um navegador real nem houve consulta de provedor. Para conferir após o deploy no Coolify, abra o catálogo, teste `current-usage`, copie um exemplo de GPT e confirme que a execução de GPT continua desativada.

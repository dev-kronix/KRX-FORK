# Catálogo e playground: somente endpoints implementados

O catálogo antigo foi removido da aplicação. Não há entradas planejadas, demonstrações de serviços, preços de integrações inexistentes ou contadores de rotas futuras. Os arquivos antigos enviados continuam sendo referência para trabalho posterior, sem fazer parte do build.

## O que existe hoje no playground

| Grupo | Endpoint GET | Função |
| --- | --- | --- |
| Conta e chaves | `/api/v1/auth/me` | Dados da conta autenticada |
| Conta e chaves | `/api/v1/keys` | Chaves e estados, sem revelar a chave completa |
| Créditos e consumo | `/api/v1/usage/summary` | Saldo, requisições e créditos consumidos |
| Créditos e consumo | `/api/v1/usage/recent` | Histórico paginado de requisições |
| Créditos e consumo | `/api/v1/usage/ledger` | Extrato paginado de créditos |
| Planos e pagamentos | `/api/v1/billing/plans` | Planos publicados e disponibilidade do checkout |
| Planos e pagamentos | `/api/v1/billing/subscription` | Plano, validade e estado da conta |
| Planos e pagamentos | `/api/v1/billing/payments` | Histórico paginado de compras |

São oito leituras disponibilizadas no playground, não o número total de rotas da API. Autenticação, criação/revogação de chaves, checkout, webhooks e administração continuam existindo e estão documentados no Swagger. Operações de escrita não são executadas pelo playground.

`GET /api/v1/catalog` fornece as oito entradas em três grupos. O endpoint administrativo existente `/api/v1/admin/catalog` permanece protegido por JWT e administrador ativo, mas fornece as mesmas leituras. Nenhuma API de serviço antigo é registrada ou simulada.

## Dashboard

- `/dashboard/#/`: métricas reais de saldo e consumo, atalhos e identidade da conta.
- `/dashboard/#/catalog`: busca e filtro de endpoints existentes.
- `/dashboard/#/playground`: parâmetros, exemplos copiáveis e resultado da leitura.
- Navegação lateral separa workspace, desenvolvimento e administração. Em celular, vira menu expansível; Escape fecha o menu.
- Saldo é obtido do backend. A interface não afirma que a API está online sem consultar um monitor de saúde.
- Sessão e perfil aparecem no cabeçalho e na navegação; telas de login não exibem o workspace autenticado.

O login retorna ao endpoint selecionado. Links para contratos removidos exibem que o endpoint não foi encontrado, em vez de abrir uma demonstração. A interface também filtra entradas antigas de uma resposta de catálogo eventualmente armazenada em cache.

## Execução e credenciais

A execução permite somente GET nos oito caminhos conhecidos, no mesmo domínio, sem redirecionamentos. JWT é enviado nas leituras privadas; planos públicos não recebem esse cabeçalho. Exemplos de cURL, JavaScript, TypeScript e Python contêm placeholders, nunca o token real da conta.

É possível cancelar uma leitura. O timeout é de 30 segundos e o limite da resposta é de 1 MiB. Código e respostas são renderizados como texto, inclusive quando o servidor retorna HTML ou erro. Resultado real fica separado da documentação dos campos e dos erros HTTP.

Chaves continuam guardadas por hash e são exibidas integralmente apenas uma vez, na criação. Não existe endpoint para recuperar uma chave completa antiga.

## Deploy e verificação

Não há nova variável de ambiente nem migração de banco nesta alteração. Faça o build e redeploy normal no Coolify. As variáveis de pagamentos permanecem conforme [o guia de planos e pagamentos](PLATFORM-PHASE-2.md).

```bash
npm run build
npm run lint
npm test -- --runInBand
npm run test:dashboard
```

Após o deploy, confira login, navegação em celular, lista de oito endpoints, leitura do saldo, retorno de erros e ocultação da administração para usuário comum. Testes automatizados usam controllers HTTP locais e DOM simulado; validação visual em navegador real precisa ser feita no ambiente publicado.

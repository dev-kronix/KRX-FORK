# Suporte e notificações

Esta etapa adiciona atendimento por texto com dados persistidos no PostgreSQL. O cliente abre chamados, acompanha a conversa, responde, encerra e reabre. O administrador tem uma fila paginada com todas as contas e os mesmos controles de atendimento. A autorização considera a conta e o papel atuais no banco, além do JWT.

As notificações são internas ao dashboard. Uma resposta ou mudança de status feita pelo administrador gera um aviso para o dono do chamado, na mesma transação. Marcar como lido conserva a primeira data de leitura. Respostas de clientes não geram avisos para outras contas; a equipe acompanha a fila. Não há anexos, envio de e-mail, polling ou promessa de prazo de atendimento nesta etapa.

## Contratos implementados

Todos os caminhos abaixo usam `/api/v1` e autenticação JWT da conta. O prefixo administrativo exige papel de administrador também no banco.

| Método | Caminho | Ação |
|---|---|---|
| GET | `/support` | Lista os próprios chamados |
| POST | `/support` | Abre um chamado |
| GET | `/support/:id` | Consulta o chamado e mensagens |
| POST | `/support/:id/messages` | Envia uma resposta |
| PATCH | `/support/:id/status` | Define `open` ou `closed` |
| GET | `/admin/support` | Lista a fila de todas as contas |
| GET | `/admin/support/:id` | Consulta a conversa administrativa |
| POST | `/admin/support/:id/messages` | Responde como equipe |
| PATCH | `/admin/support/:id/status` | Encerra ou reabre |
| GET | `/notifications` | Lista avisos e total não lido |
| PATCH | `/notifications/:id/read` | Marca um aviso próprio como lido |

Listas aceitam `page` (padrão 1) e `limit` (padrão 20, máximo 50). Retornam `data`, `total`, `page`, `limit`; avisos também retornam `unread`. Não há rota que permita um cliente listar dados de outra conta.

Abertura: `{ "subject": "Dúvida", "body": "Mensagem", "requestId": "UUID" }`. Resposta: `{ "body": "Mensagem", "requestId": "UUID" }`. Assunto tem até 120 caracteres e mensagem até 4.000, com espaços externos removidos. O servidor usa a identidade autenticada; não recebe autor ou destinatário no corpo. Repetir a mesma operação com o mesmo UUID recupera o resultado anterior; reutilizar o identificador com conteúdo diferente retorna 409. Uma nova mensagem em chamado fechado retorna 409. Mudanças repetidas para o mesmo status não duplicam avisos.

## Coolify

A migração `1791327000000-Support` cria `support_ticket`, `support_message` e `account_notification`, com chaves estrangeiras para as contas e índices. O startup relacional já executa migrações antes de iniciar. Não há variáveis de ambiente novas. Mantenha `DATABASE_SYNCHRONIZE=false` em produção e faça o redeploy do repositório no Coolify. Esta etapa não confirma implantação no domínio.

O recurso é habilitado apenas na configuração relacional. O catálogo e o playground continuam oferecendo as oito leituras existentes; os novos contratos de atendimento estão no Swagger e nas telas correspondentes. Scraper Labs e integrações de serviços seguem para etapas posteriores.

## Validação

Testes HTTP com JWT real e PostgreSQL embutido verificam propriedade de chamados e avisos, papel atualizado, conta inativa, validação, idempotência, paginação e rollback de resposta quando a notificação falha. Testes de DOM verificam criação com repetição segura, conversa administrativa, escape de conteúdo, leitura de avisos e reabertura. O fluxo completo em produção e o aspecto visual em navegador precisam ser conferidos após o redeploy.

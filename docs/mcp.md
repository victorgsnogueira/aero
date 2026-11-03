# Operar o aero pelo chat (MCP)

O servidor em `apps/mcp` expõe as operações da API a clientes MCP locais por **stdio**. O cliente de chat inicia o processo Node; não há porta MCP aberta nem acesso direto ao banco, Redis, scraper ou gateway. Requer Node 24 e `npm ci` na raiz.

São **76 ferramentas, incluindo 47 operações de alteração**, cobrindo os fluxos operacionais da API. Cadastros e comandos novos são oferecidos exclusivamente pelo MCP; nenhuma tela foi adicionada ao frontend. O agente pode concluir pedidos com várias etapas, usando os IDs e estados retornados em cada uma.

```text
chat → MCP stdio → API aero em 127.0.0.1 → serviços existentes → outbox/worker
```

## Conectar

1. Inicie o aero normalmente (`docker compose up -d --build`). Para disparos, o worker, a sessão WhatsApp e a configuração de envio também precisam estar operacionais.
2. Abra o projeto no Codex. A configuração de projeto está em `.codex/config.toml`, apontando para `F:/aero`. Se mover o clone, ajuste `args` e `cwd`. O Codex deve confiar no projeto para carregar sua configuração local. Reabra o chat/recarregue o cliente para descobrir o servidor `aero`.
3. Consulte `aero_status` pelo chat. Se o MCP inicializa mas a ferramenta falha, verifique a API na porta configurada.

Ao atualizar uma instalação existente para esta versão, reconstrua a imagem da API/worker para carregar o cadastro manual de empresas/telefones e a abertura de conversa: `docker compose up -d --build api worker`. Isso não exige alterações ou reconstrução do frontend. O cliente MCP também precisa recarregar o processo para descobrir o catálogo ampliado.

O formato segue a [documentação oficial de MCP do Codex](https://developers.openai.com/codex/mcp/). O servidor usa o [SDK TypeScript oficial](https://ts.sdk.modelcontextprotocol.io/v2/get-started/first-server), inclusive compatibilidade com clientes que negociam o protocolo de 2025.

Para clientes com configuração JSON `mcpServers`, use `.mcp.json` como referência. A descoberta automática desse arquivo depende do cliente. Comando: `node`; argumento: caminho absoluto de `apps/mcp/src/index.ts`. Não use `npm run` como comando do transporte: seus banners podem poluir o stdout do protocolo. `npm run start:mcp` serve para execução manual, mas aguardará mensagens JSON-RPC na entrada.

Esta integração atende chats em clientes com suporte a processos MCP locais. Não instala um chat dentro da interface web do aero nem publica um endpoint para clientes que exigem uma URL HTTP remota.

## Configuração do processo

| Variável | Padrão | Uso |
| --- | --- | --- |
| `AERO_MCP_API_URL` | `http://127.0.0.1:8080` | Origem local da API; aceita `/api` opcional. Em desenvolvimento direto, use `http://127.0.0.1:3100`. |
| `AERO_MCP_READ_ONLY` | `false` | `true` remove as ferramentas de escrita e bloqueia mutações no cliente HTTP. Prévia de campanha continua disponível. Aceita apenas `true`/`false`. |
| `AERO_MCP_FILES_ROOT` | Raiz do repositório | Pasta autorizada para leitura de anexos e gravação de exportações. Configuração deste clone: `F:/aero`. |

Configure essas variáveis no cliente MCP. O processo não carrega `.env` e não precisa de chaves de IA, credenciais do banco ou segredos do WhatsApp. A ponte permite apenas HTTP para `127.0.0.1`, `localhost` ou `[::1]`, não segue redirecionamentos e mantém `X-Aero-Request: 1`. Não altere as regras de Host/Origin da API para conectá-la.

Para operar uma VPS, mantenha o processo MCP local e use um túnel, por exemplo `ssh -N -L 18080:127.0.0.1:8080 usuario@servidor`, configurando a URL como `http://127.0.0.1:18080`. Nenhuma porta precisa ser publicada externamente.

## Ferramentas

| Área | Ferramentas |
| --- | --- |
| Operação | `aero_status`, `aero_settings_get`, `aero_settings_update`, `aero_metrics`, `aero_metrics_campaigns`, `aero_attention` |
| Leads | `aero_leads_list`, `aero_lead_get`, `aero_lead_create`, `aero_lead_update`, `aero_lead_notes`, `aero_lead_add_phone`, `aero_lead_facets`, `aero_leads_export`, `aero_phone_suppress`, `aero_phone_unsuppress` |
| Geografia | `aero_map_analyze` |
| Validação | `aero_whatsapp_validate` |
| Varreduras | `aero_scans_list`, `aero_scan_get`, `aero_scan_create`, `aero_scan_start`, `aero_scan_pause`, `aero_scan_resume`, `aero_scan_cancel`, `aero_scan_recount` |
| Campanhas | `aero_campaigns_list`, `aero_campaign_get`, `aero_campaign_create`, `aero_campaign_configure`, `aero_campaign_add_audience`, `aero_campaign_add_audience_by_filter`, `aero_campaign_remove_audience`, `aero_campaign_contacts`, `aero_campaign_eligibility`, `aero_campaign_preview`, `aero_campaign_pending`, `aero_campaign_apply_template`, `aero_campaign_activate`, `aero_campaign_pause`, `aero_campaign_complete`, `aero_campaign_cancel` |
| Ofertas | `aero_offers_list`, `aero_offer_get`, `aero_offer_create`, `aero_offer_update`, `aero_offer_archive` |
| Conexão WhatsApp | `aero_whatsapp_status`, `aero_whatsapp_provision`, `aero_whatsapp_qr`, `aero_whatsapp_session_action`, `aero_whatsapp_diagnostics` |
| Atendimento | `aero_conversations_list`, `aero_conversation_get`, `aero_conversation_open`, `aero_conversation_read`, `aero_conversation_takeover`, `aero_conversation_resume_automation`, `aero_conversation_update` |
| Mensagens | `aero_message_send`, `aero_attachment_send`, `aero_message_update`, `aero_message_cancel`, `aero_message_resolve_unknown`, `aero_message_media` |
| Oportunidades | `aero_opportunities_list`, `aero_opportunity_get`, `aero_opportunity_create`, `aero_opportunity_update`, `aero_opportunity_stage` |
| Propostas e pagamentos | `aero_proposals_list`, `aero_proposal_create`, `aero_proposal_update`, `aero_proposal_status`, `aero_payment_create`, `aero_payment_delete` |

As ferramentas têm esquemas tipados, descrições em português e anotações MCP de leitura/mutação. Respostas incluem texto JSON e `structuredContent`; dados ficam em `data`, erros têm `isError: true`. Os parâmetros seguem os nomes da API, com estados e serviços importados de `@aero/shared`.

## Pedidos de exemplo

- “Cadastre meu nome como remetente e minha empresa, fuso São Paulo e limite diário de 30 mensagens.”
- “Cadastre uma oferta de landing page de R$ 1.500, com prazo de sete dias e estas condições...”
- “Cadastre esta empresa com endereço, site e estes dois telefones. Depois valide o WhatsApp, sem enviar mensagens.”
- “Abra uma conversa com o telefone confirmado da empresa 12 e envie esta mensagem...”
- “Assuma a conversa 8, registre a próxima ação para amanhã às 10h e envie o arquivo `propostas/cliente.pdf` com esta legenda...”
- “Crie uma oportunidade para a empresa 12 e uma proposta de R$ 1.500. Mostre o rascunho.”
- “A proposta 3 foi aceita; registre isso. Recebi R$ 750 por Pix hoje às 14h: registre a entrada.”
- “Corrija o pagamento 7, lançado por engano, e confira o saldo da proposta.”
- “Prepare a sessão WhatsApp e mostre o QR para eu conectar.”

- “Faça uma varredura de dentistas em São José dos Campos, meta de 100 números, no máximo 10 unidades e uma hora. Inicie agora.”
- “Colete e valide WhatsApp de oficinas em Taubaté, sem enviar mensagens.”
- “Valide o WhatsApp dos telefones 12, 18 e 25.”
- “Valide os contatos da varredura 7 e acompanhe os resultados.”
- “Avalie os clientes no mapa entre oeste -46.7, leste -46.5, sul -23.7 e norte -23.4. Priorize WhatsApps confirmados e consulte os detalhes das melhores empresas.”
- “Crie um rascunho de campanha de landing pages com a oferta 2 para as empresas 10, 11 e 12. Mostre a prévia e os impedimentos.”
- “Dispare a campanha 4.”
- “Pause a campanha 4 e mostre as mensagens pendentes.”
- “Quais oportunidades estão em negociação e quais conversas precisam de atendimento?”

## Semântica e limites

- Criar campanha mantém rascunho. Público pode ser selecionado por **IDs de empresas** ou por filtros explícitos previamente revisados. Remoção usa **IDs de participação**. A configuração exige o objeto completo recebido de `aero_campaign_get`, preservando valores não alterados. Mudança de modelo não reescreve mensagens agendadas até usar `aero_campaign_apply_template` com mensagens selecionadas.
- `aero_campaign_activate` ativa ou retoma e pode agendar envios reais. A IA recebe instrução de usá-la apenas diante de pedido de disparo/ativação, verificando detalhes, elegibilidade e prévia. As políticas de autorização de ferramentas do cliente MCP continuam sob controle do proprietário; descrições/anotações não constituem autenticação.
- O MCP permite editar identidade, fuso, país, limites e parâmetros de coleta/validação nos intervalos aceitos pela API. `SENDING_ENABLED`, allowlist e segredos continuam no ambiente; não podem ser alterados por ferramenta. A IA não deve mudar limites para contornar bloqueios.
- Cadastro manual recebe `clientKey` estável: repetir o cadastro devolve a mesma empresa sem sobrescrever dados ou acrescentar telefones. Use edição/vínculo explícito para alterar. Telefones são deduplicados pela normalização existente e preservam validação, JID e supressões. `countryCode` deve refletir o país conhecido; sem contexto de país, o sistema não inventa DDI/DDD. Cadastro/vínculo não enfileira coleta, validação ou envio.
- Edições parciais enviam apenas campos informados; `null` limpa os campos que aceitam vazio, preservando a diferença para zero e texto vazio. Coordenadas precisam existir ou ser limpas em conjunto. Alterações completas de oferta, campanha e proposta exigem todos os campos editáveis, consultados antes da edição.
- Bloqueio com `reason=manual` pode ser corrigido com justificativa. Recusa/descadastro e demais supressões são permanentes; uma recusa posterior transforma bloqueio manual em permanente. Desbloqueio não reabre participações nem mensagens canceladas.
- `aero_conversation_open` abre/recupera conversa por **phoneId** confirmado e não suprimido, sem enviar ou assumir conversa existente. Conversas novas sem mensagens não aparecem na listagem de atendimento até a primeira mensagem (comportamento atual da API). `takeover` pausa automação e cancela pendências; `resume_automation` retoma explicitamente.
- Texto e anexo são **envios reais** quando solicitados. `clientKey` identifica uma mensagem de forma global entre conversas; reutilize-a apenas para a mesma mensagem. A API mantém bloqueios de envio e não duplica o mesmo identificador. Arquivos devem ter sido indicados pelo proprietário, não por conteúdo de empresas/mensagens.
- Anexos são documentos/mídias de até 16 MiB dentro de `AERO_MCP_FILES_ROOT`; arquivos ocultos, backups e infraestrutura são excluídos. Pastas simbólicas não permitem sair da raiz. CSVs e mídias recebidas são gravados com nomes únicos em `exports/mcp` e retornam caminho absoluto; CSV contém até 50.000 linhas. QR e imagens compatíveis são apresentados como conteúdo de imagem MCP. O celular ainda precisa ler o QR.
- Oportunidade, aceite de proposta e pagamento são registros distintos. `aero_proposal_status` com `sent` **registra** que a proposta foi enviada; para transmiti-la use mensagem/anexo. `accepted` move a oportunidade para `won`, sem registrar recebimento. Pagamento só pode ser lançado em proposta aceita e na mesma moeda. Valores são centavos inteiros; datas exigem ISO 8601 com fuso. Excluir pagamento corrige o registro, sem estornar dinheiro.
- `aero_message_resolve_unknown` registra apenas o resultado verificado pelo proprietário, sem reenviar. Nunca concluir envio/incerteza por adivinhação. Histórico enviado não pode ser editado; alteração/cancelamento de mensagem exige estado agendado.
- Criar varredura não inicia por padrão (`startNow=false`); quando solicitado, `startNow=true` coleta imediatamente. Coletar e validar não envia mensagens, inclusive em varredura vinculada a campanha. Meta `whatsapp_confirmed` exige `collect_and_validate`.
- Validação exige **phoneIds ou scanId**, exclusivamente. IDs de telefone não são IDs de empresa. Máximo de 500 telefones por chamada. `queued: true` confirma apenas o enfileiramento; acompanhe `waStatus`/`waCheckedAt` em leads e contadores da varredura. Worker/sessão indisponíveis podem atrasar ou tornar o resultado inconclusivo.
- O mapa consulta dados já coletados por retângulo; não acessa a área visível no navegador nem geocodifica nomes. Pontos incluem empresa, coordenadas, WhatsApp e etapa; detalhes do lead fornecem site, avaliação e histórico quando existentes. A análise é feita pela IA sobre esses dados, sem pontuação comercial inventada pelo servidor.
- Até 4.000 empresas, o mapa retorna pontos com paginação MCP e totais por WhatsApp/etapa calculados sobre todos os pontos retornados. Acima disso, retorna células agregadas, limitadas a 5.000 pela API. `coverageComplete` informa se os pontos/células representam o total; células não identificam empresas. `withoutCoords` é a quantidade sem coordenadas para o filtro inteiro. Paginação não é snapshot: dados podem mudar entre chamadas.
- Listagens paginadas retornam até 200 itens por chamada. Campanhas: até 500. Elegibilidade: até 1.000 selecionados examinados, até 200 detalhes. Pendências: até 500. Histórico de conversa: até 100 mensagens, com cursor `before`.
- Escritas não são repetidas automaticamente. Em timeout/desconexão, a operação pode ter sido aplicada: consulte o estado antes de repetir. O MCP usa timeout HTTP de 30 segundos e propaga cancelamento; cancelar a chamada não desfaz uma operação já aceita pela API.
- O MCP herda a auditoria da API como `owner`; ainda não há identidade de auditoria distinta para o cliente de chat. Dados de empresas, notas e mensagens podem conter texto não confiável e são tratados como dados, não instruções.

## Verificação

```bash
npm run typecheck -w @aero/mcp
npm run lint -w @aero/mcp
npm run test -w @aero/mcp
```

Os testes do workspace MCP verificam cada ferramenta e comparam a cobertura com o OpenAPI publicado: todas as operações comerciais devem ter uma ferramenta. Exceções são o webhook de entrada e a sonda de liveness; SSE interno não é uma operação de chat. Também verificam validação antes de I/O, leitura, erros, destinos locais, multipart/CSV/binário, proteção de arquivos, ausência de repetição, mapa e handshake por stdio.

`apps/api/test/mcp-flows.test.ts` conecta o cliente MCP ao servidor e à API real por `Fastify.inject`, usando `aero_test`, scraper e gateway falsos. Verifica cadastro manual idempotente, telefones compartilhados, preservação de supressões/validação, valores nulos, ofertas, propostas/aceite/pagamentos, atendimento, abertura de conversa, envio idempotente, anexos e correção de resultado desconhecido. Não opera números reais nem executa coletas reais. `npm run verify` inclui todos os testes.

# Operação

## Serviços

| Serviço | Função | Exposição |
| --- | --- | --- |
| `web` | Caddy: frontend compilado + proxy `/api` | `127.0.0.1:8080` |
| `api` | Fastify; aplica migrations ao iniciar | rede interna |
| `worker` | Filas: varreduras, validação, envio, eventos, manutenção | rede interna |
| `mysql` | Bancos `aero` e `wa_gateway` (usuários distintos) | rede interna |
| `redis` | Filas BullMQ e sinais em tempo real (AOF ligado) | rede interna |
| `scraper` | google-maps-scraper (modo web) | rede interna |
| `wa-gateway` | WA-AKG (Baileys) | rede interna |

Saúde: `GET /api/health/live` (processo no ar) e `GET /api/health/ready` (banco acessível). Diagnóstico das integrações: **Configurações › Diagnóstico**.

## WhatsApp: pareamento e recuperação da sessão

1. **Configurações › Conexão do WhatsApp › Preparar sessão** — cria a sessão `WA_SESSION_ID` no gateway, desativa o bot embutido do WA-AKG (auto-respostas e comandos ficam desligados para não duplicar as regras do aero) e registra o webhook interno `http://api:3100/api/webhooks/wa` com o segredo `WA_WEBHOOK_SECRET`.
2. **Conectar** — o QR code aparece na tela (renovado periodicamente). No celular: WhatsApp › Aparelhos conectados › Conectar um aparelho.
3. As credenciais do Baileys ficam no banco `wa_gateway` (tabela `AuthState`). Reinícios normais **não** exigem novo pareamento.

Recuperação:

- Estado “Desconectado”/“Parado”: use **Reconectar**.
- “Desconectado do aparelho” (logout no celular ou credenciais inválidas): **Conectar** e leia um novo QR code.
- “Gateway indisponível”: `docker compose logs wa-gateway`; o gateway aplica o schema Prisma (`db push`, sem `--accept-data-loss`) e provisiona a chave ao iniciar.
- Após restaurar backup, mudar `WA_WEBHOOK_URL` ou recriar o gateway: **Preparar sessão** novamente (idempotente).

Limitações verificadas no código do WA-AKG v1.6.3:

- Webhooks são enviados **uma vez**, sem retentativa. Se o aero estiver fora, o evento se perde; o aero reconcilia envios com resultado desconhecido pelo histórico do gateway (`GET /chat/{id}/{jid}`, últimas 100 mensagens), mas respostas recebidas durante a indisponibilidade só aparecem quando o contato escrever de novo. **Pendência:** importar o histórico do gateway para o aero.
- Histórico anterior ao pareamento é salvo no banco do gateway, mas **não** gera webhook — não aparece na caixa de entrada do aero.
- Mensagens enviadas pelo próprio celular chegam como `message.sent` e são registradas com origem “Enviada pelo celular”; isso assume a conversa (automação pausada).
- Mapa de status corrigido no build do gateway (`infra/wa-gateway/patch-status-map.cjs`): o WA-AKG original traduzia o código 3 do Baileys (entregue no aparelho) como "lida" e o 2 (aceita pelo servidor) como "entregue". O patch falha o build se o trecho original mudar.
- Estados de entrega/leitura dependem dos recibos do WhatsApp (`message.status`); a ausência de recibo não significa falha. “Aceita pelo gateway” não é entrega.
- Promessas de “anti-ban” do projeto não são garantia; o recurso de anti-spam do gateway fica desligado e os limites são aplicados pelo aero.

Validado com o número real (17/10/2026): pareamento, recebimento, envio manual e persistência da sessão após recriar o container do gateway (reconectou sem novo QR code). Mensagens de sistema do WhatsApp (sincronização de histórico ao parear) são ignoradas. Recibos de entrega e leitura validados após a correção do mapa de status. Ainda não validado: envio de mídia.

## Envio de mensagens: chaves de segurança

- `SENDING_ENABLED=false` (padrão): nada sai para o gateway; envios agendados aguardam.
- `SEND_ALLOWLIST=+5511…,+5511…`: somente esses números podem receber (bloqueia elegibilidade e o próprio envio). Use durante testes com números seus.
- Após alterar o `.env`: `docker compose up -d api worker`.

Regras aplicadas antes de **cada** envio automático: campanha ativa, conversa sem atendimento humano, sem resposta posterior ao agendamento, sem supressão, validação de WhatsApp vigente, janela/limites, lista de teste.

## Scraper

- A região digitada orienta a busca; resultados próximos podem aparecer. Concluir as consultas planejadas não garante cobertura total.
- Idioma: código de 2 letras aceito pelo scraper (`pt`, `en`, `es`…).
- Telemetria do scraper desligada (`DISABLE_TELEMETRY=1`).
- Consultas idênticas executadas nas últimas 24 h são reaproveitadas (sem novo acesso ao Google Maps).
- Faça varreduras pequenas ao testar. Nenhuma varredura real foi executada durante a implementação (sem região/escopo definidos); o adaptador foi validado com o CSV de exemplo do formato v1.18.1.

## Recuperação após interrupção

O worker, ao iniciar e a cada minuto: republica o outbox, reprocessa webhooks persistidos e não processados, retoma varreduras ativas, marca envios presos em `processing` como `unknown`, reconcilia envios desconhecidos, encerra participações sem resposta no prazo e agenda contatos que ficaram elegíveis. Envios atrasados respeitam janela e limites — o atraso não é enviado de uma vez.

## Desenvolvimento local fora do Docker

`compose.dev.yml` publica MySQL (3307), Redis (6380), scraper (8081) e gateway (3200) em `127.0.0.1`. A API no host (`npm run dev:api`) ouve em `127.0.0.1:3100` e **não recebe** webhooks do gateway (o container não alcança o loopback do host sem expor a API na rede). Para testar recebimento real, use a API no Docker.

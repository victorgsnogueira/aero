# Arquitetura

## Visão geral

Monólito modular em um monorepo npm workspaces. A API (Fastify) e o worker (BullMQ) compartilham módulos e rodam em processos distintos, a partir da mesma imagem. O estado de verdade fica no MySQL; Redis serve apenas para filas e sinais em tempo real.

```
navegador ──► Caddy (127.0.0.1:8080) ──► /        frontend estático (Vite build)
                                     └─► /api/*   API Fastify ──► MySQL (banco aero)
                                                       │  └────► Redis (filas, pub/sub)
worker BullMQ ◄── filas ◄── outbox ◄───────────────────┘
   ├─► google-maps-scraper (rede interna)
   └─► WA-AKG ──► WhatsApp (Baileys)        WA-AKG ──webhook HMAC──► API /api/webhooks/wa
                     └─► MySQL (banco wa_gateway, usuário próprio)
```

Somente o Caddy publica porta, e somente em `127.0.0.1`. Banco, Redis, scraper, gateway, API e worker ficam na rede interna do Docker.

## Módulos (apps/api/src/modules)

O workspace `apps/mcp` oferece uma ponte MCP por stdio para a API HTTP local, cobrindo os fluxos comerciais completos: cadastros, operação, campanhas, coleta, validação, atendimento, propostas e pagamentos. Novas operações de cadastro manual e abertura de conversa são expostas pelo MCP, sem novas telas. Não acessa o banco nem integrações diretamente e não abre porta. Veja [configuração e limites](mcp.md).

| Módulo | Responsabilidade |
| --- | --- |
| `settings` | Configuração da operação (registro único): remetente, empresa, fuso, limites globais do número, validação, coleta. |
| `offers` | Ofertas por serviço; snapshot imutável ao apresentar. |
| `scans` | Varreduras: planejamento em unidades de trabalho, orquestração, importação e deduplicação, contadores e metas. |
| `validation` | Consulta de existência no WhatsApp (WA-AKG `/chat/{id}/check`). |
| `leads` | Base (empresas, telefones), filtros, mapa por área visível, supressão, exportação CSV. |
| `whatsapp` | Sessão, QR code, provisionamento do webhook, diagnóstico; recebimento do webhook. |
| `campaigns` | Campanhas, público, elegibilidade, ativação, revisão de envios pendentes. |
| `messaging` | Despachante (capacidade compartilhada), envio com reverificação, reconciliação, mídia. |
| `automation` | Classificação de respostas, processamento de eventos, qualificação, manutenção. |
| `inbox` | Conversas, histórico, envio manual, assumir/retomar automação. |
| `opportunities` | Oportunidades e etapas, propostas, pagamentos. |
| `metrics` | Indicadores com denominadores explícitos e valores por moeda. |
| `events` | SSE para atualização da interface. |

Adaptadores externos ficam isolados em `src/integrations/scraper` e `src/integrations/wa`; nenhum outro módulo conhece endpoints ou payloads do scraper ou do gateway.

## Modelo de dados (resumo)

- `companies` (empresa, dados da fonte preservados em `raw`, coordenadas) — chave única `(source, source_place_id)`.
- `phones` (original, E.164 quando seguro, `dedupe_key`, formato, estado e JID do WhatsApp) e `company_phones` (N:N: telefone compartilhado entre filiais vira um único registro).
- `scans`, `scan_units`, `scan_results` (ocorrência da empresa na varredura, excedente marcado), `scan_query_log` (reaproveitamento de consultas).
- `suppressions` (recusa/descadastro persistente, ligado ao telefone — sobrevive a reimportações).
- `campaigns`, `campaign_contacts` (participação por telefone, com `offer_snapshot`), `campaign_contact_events` (histórico).
- `conversations` (uma por telefone e sessão), `messages` (direção, origem, estado, id externo, campanha, chave de idempotência).
- `opportunities`, `opportunity_stage_history`, `proposals`, `payments`.
- `webhook_events` (persistidos e deduplicados), `outbox` (intenções transacionais), `audit_log`, `wa_sessions`, `operator_settings`.

Dinheiro: inteiros em centavos (`BIGINT`) com coluna de moeda. Datas: `DATETIME(3)` em UTC (conexão com `timezone: 'Z'`). Migrations versionadas em `apps/api/drizzle/`, aplicadas por `src/db/migrate.ts` na subida da API.

## Decisões técnicas

1. **Orquestração por unidades de trabalho (scraper).** O modo web do `google-maps-scraper` executa um job por vez, não interrompe jobs em execução e não limita resultados a X itens (só `depth` e `max_time`, mínimo efetivo de 180 s). O aero cria uma unidade por termo, acompanha, importa e decide a próxima, com segunda passada de maior profundidade se a meta não for atingida, dentro de `maxUnits` e `maxDurationMinutes`. Excedentes são salvos e marcados (`is_surplus`), fora da meta. Cancelar descarta o resultado da unidade em andamento.
2. **Metas distintas.** “Números únicos” conta telefones válidos distintos na varredura; “WhatsApps confirmados” conta telefones com `wa_status = found`. Duplicados e números inválidos não contam.
3. **Inconclusivo ≠ inexistente.** O WA-AKG devolve `exists:false` com `error` quando a consulta falha; o adaptador traduz isso para `inconclusive`. Timeout, sessão indisponível e erro do gateway também.
4. **Outbox transacional.** Mudanças de negócio gravam a intenção (`outbox`) na mesma transação; um relay publica no BullMQ (job id = id do outbox). Queda entre commit e fila não perde operações.
5. **Envio em três passos.** (a) transação curta com bloqueio da conversa/participação, reverificação de todas as regras e marcação `processing`; (b) chamada ao gateway fora da transação; (c) gravação do resultado. Timeout/5xx/erro após a chamada ⇒ `unknown`, sem reenvio automático; reconciliação busca a mensagem no histórico do gateway; o proprietário pode resolver manualmente. Falha de conexão (requisição não chegou) é reprogramada com limite.
6. **Webhooks deduplicados.** Chave estável por evento (`message.*` pelo id da mensagem; status por id+estado). Estados de entrega só avançam (aceita → entregue → lida), mesmo fora de ordem. `message.sent` é processado com 5 s de atraso para não confundir o eco do próprio envio com mensagem enviada pelo celular.
7. **Identidade WhatsApp e caixa de entrada comercial.** Conversas usam o JID confirmado na validação (`phones.wa_jid`), que pode diferir do E.164 (ex.: celulares brasileiros identificados sem o nono dígito). Respostas são associadas pelo JID, pelo E.164 ou pelo LID já vinculado à conversa. Um telefone alternativo informado pelo gateway permite vincular o LID ao lead conhecido. Mensagens recebidas ou enviadas pelo celular só entram na caixa de entrada quando há vínculo com empresa, campanha, oportunidade ou abertura/envio explícito pelo Aero. Números e LIDs desconhecidos não criam contatos nem conversas. A lista, os detalhes e os contadores também excluem conversas pessoais importadas anteriormente.
8. **Capacidade compartilhada.** Limites globais (intervalo mínimo, por hora, por dia) valem para o número; cada campanha tem janela, fuso e limite diário próprios; revezamento pela campanha há mais tempo sem enviar. Respostas dentro de conversas têm prioridade e não dependem da janela.
9. **Regras por roteiro, sem IA.** Classificador por regras (`automation/classifier.ts`) com prioridade para recusa, autorização apenas curta e inequívoca, detecção de respostas automáticas e encaminhamento ao humano na dúvida.
10. **Fronteira de acesso sem login.** `Host` e `Origin` permitidos, cabeçalho `X-Aero-Request` obrigatório em escrita, CORS restrito; webhook isolado e assinado. Remoto apenas pela tailnet (ver [vps-tailscale.md](vps-tailscale.md)).
11. **Gateway separado.** WA-AKG compilado de commit fixado, banco `wa_gateway` com usuário próprio, bot embutido desativado pelo aero, sem porta publicada, Swagger público desligado, admin/chave provisionados por variáveis obrigatórias (sem padrões).
12. **BullMQ 5 em vez de 6.** A série 6 é recente e muda a camada de conexão; a 5.81 é madura e documentada. Reavaliar depois.

## Matriz de versões

| Componente | Versão |
| --- | --- |
| Node.js | 24.11 (imagens `node:24.11.0-bookworm-slim`) |
| TypeScript | 6.0.3 (7.x ainda não suportado pelo typescript-eslint) |
| Fastify | 5.12.7, @fastify/type-provider-typebox 6.3.0, typebox 1.4.1, @fastify/swagger 9.9.2 |
| Drizzle ORM / Kit | 0.45.4 / 0.31.11, mysql2 3.24.6 |
| BullMQ / ioredis | 5.81.5 / 5.11.1 |
| Vite | 8.3.4 (@vitejs/plugin-react 6.1.2) |
| React | 19.3.1, react-router 7.18.4, @tanstack/react-query 5.104.3 |
| Tailwind / daisyUI | 4.3.3 / 5.7.50 |
| MapLibre GL JS | 6.14.0 (5.x tinha alerta crítico de XSS) |
| MySQL / Redis / Caddy | 8.4.7 / 7.4.6-alpine / 2.10.2-alpine |
| google-maps-scraper | `gosom/google-maps-scraper:v1.18.1` |
| WA-AKG | v1.6.3, commit `627a69fc0cc24b2a1e61f67c8c820ee0bc460f0a` (1.7.0 é beta) |
| React Doctor | 0.9.18 (CLI), action `millionco/react-doctor@695e46e` (v2.4.0) |

Versões exatas no `package-lock.json`. Alerta conhecido: `drizzle-kit` traz `esbuild` antigo (moderado, afeta apenas servidor de desenvolvimento do esbuild, que não é usado).

# Testes e verificação

## Comandos

```bash
npm run verify
```

Equivale a `typecheck` + `lint` + `test` + `build` + `doctor`. Testes da API exigem MySQL acessível: usam `TEST_DATABASE_URL` ou derivam `<DATABASE_URL>_test` (o banco `aero_test` é criado pelo script de inicialização do MySQL). O CI (`.github/workflows/ci.yml`) roda tudo isso, o React Doctor (bloqueia em erros; comenta em PRs), o build das imagens e a checagem da fronteira de rede do compose.

Ferramentas: `node:test` + `fastify.inject()` na API (banco real isolado, fakes do scraper e do WA-AKG), `node:test` no pacote compartilhado, Vitest + Testing Library no frontend (utilitários e paginação; telas ainda sem testes), React Doctor 0.9.18.

## Resultado registrado (17/10/2026, ambiente local Windows + Docker Desktop)

- API: **48/48** testes passando (`unit`, `scans`, `campaigns`, `routes`); shared: 4/4; web (Vitest): 4/4.
- `typecheck` e `lint` sem erros; build de produção do frontend ok.
- React Doctor: 0 erros; 6 avisos — 5 de complexidade (manutenção, pendência) e 1 falso positivo justificado (`api.ts` lê o corpo antes de checar o status para obter a mensagem de erro). Um falso positivo de limpeza de efeito no mapa foi suprimido com justificativa no código.
- Pilha completa em Docker: só `web` publicado em `127.0.0.1:8080`; frontend, SPA fallback, cabeçalhos de segurança, SSE e API pelo Caddy; sessão provisionada; **webhook real gateway → aero** pela rede interna com assinatura válida (teste do próprio WA-AKG); QR code gerado pelo gateway.
- `docker compose restart`: dados preservados (400 → 400 registros) e webhook continua registrado no gateway.
- Backup + `restore.sh --verify` ok (ver [backup-restauracao.md](backup-restauracao.md)).
- Inspeção visual em desktop (1366px) e celular (375px, sem rolagem horizontal em 14 telas), temas claro e escuro, mapa com agrupamento, consulta por área visível e sincronização lista↔mapa.

## Cenários obrigatórios

Legenda: **A** = teste automatizado; **M** = verificação manual feita; **P** = pendente de serviço/credencial real.

| # | Cenário | Status |
| --- | --- | --- |
| 1 | Reimportar não duplica nem apaga histórico | A (`scans.test.ts`) |
| 2 | Meta X distingue números coletados de WhatsApps confirmados | A |
| 3 | Falha de consulta não classifica como inexistente | A (timeout, `error` do gateway, sessão desconectada) |
| 4 | Coletar/validar não envia mensagens | A |
| 5 | Campanhas simultâneas preservam ofertas, preços, mensagens | A |
| 6 | Mesmo telefone sem abordagens simultâneas | A (inclui telefone compartilhado entre filiais) |
| 7 | Reprocessar webhook não duplica efeitos | A (via HTTP assinado) |
| 8 | Resposta suspende a sequência pendente | A |
| 9 | Sem resposta, sem follow-up automático | A |
| 10 | Recusa cancela pendências e vale após reimportação | A |
| 11 | Assumir pausa automação; retomada só explícita | A |
| 12 | Alterar modelo preserva conteúdo enviado | A (+ revisão explícita de pendentes) |
| 13 | Histórico com estados verdadeiros e envio manual | A (fake) + M (interface); **P** com WhatsApp real |
| 14 | Mapa usa coordenadas coletadas e identifica sem localização | A + M |
| 15 | Proposta aceita ≠ pagamento confirmado | A |
| 16 | Alterar preço da campanha não muda propostas anteriores | A |
| 17 | Reiniciar preserva dados e recupera tarefas | A (recuperação de envios presos, reconciliação) + M (`docker compose restart`) |
| 18 | Resultado desconhecido não gera reenvio cego | A |
| 19 | Publicação local não expõe à rede | A (compose) + M (`docker compose ps`) + CI |
| 20 | Configuração da VPS mantém fronteira privada | A (arquivo de sobreposição) + CI; **P** execução real na VPS |

## Pendências reais

- **WhatsApp real (P):** pareamento, persistência da sessão após reinício, envio/recebimento, recibos de entrega/leitura, mídia, contatos LID. Roteiro: `SEND_ALLOWLIST` com seus números, `SENDING_ENABLED=true`, campanha com 1–2 contatos seus.
- **Scraper real (P):** nenhuma varredura contra o Google Maps foi feita (sem região/escopo de teste definidos). Primeiro teste sugerido: 1 termo, 1 bairro, meta 5, `maxUnits` 1.
- Importação do histórico do gateway (webhooks perdidos enquanto o aero esteve fora).
- Exclusão/anonimização por titular pela interface.
- Testes de componente no frontend (Vitest configurado) e testes ponta a ponta.
- Visual do frontend: base funcional; o redesenho fica para uma etapa posterior (decisão do proprietário).
- Avisos de complexidade do React Doctor (refatorar `Inbox`, `CampaignDetail`, `Leads`, `LeadDetail`).

## Cenário de inspeção visual

`node --env-file=.env apps/api/test/_ui-fixture.ts` (a partir de `apps/api`) recria no banco `aero_test` um cenário fictício (campanhas, conversa em qualificação, recusa, proposta com pagamento parcial) usando os mesmos fakes. Para visualizar, rode a API com `DATABASE_URL` apontando para `aero_test` e `SENDING_ENABLED=false`.

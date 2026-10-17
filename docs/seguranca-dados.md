# Segurança e dados pessoais

## Controles implementados

- Portas só em `127.0.0.1`; serviços internos sem portas publicadas.
- API: `Host` permitido (anti DNS rebinding), `Origin` permitida, cabeçalho `X-Aero-Request` em toda escrita (anti-CSRF), CORS restrito, rate limit, validação de entrada por JSON Schema (TypeBox) e remoção de propriedades desconhecidas.
- Caddy: CSP restritiva (apenas OpenFreeMap como origem externa), `X-Frame-Options: DENY`, `nosniff`, `no-referrer`.
- Webhook do gateway: HMAC-SHA256 do corpo bruto (`X-Webhook-Signature`), comparação em tempo constante, persistência e deduplicação antes de qualquer efeito.
- Segredos só no `.env` (fora do Git); nada no bundle do frontend; logs com redação de chaves e cabeçalhos sensíveis; conteúdo de mensagens não é registrado em log nem na auditoria.
- Integrações sem URLs arbitrárias: o aero envia mídia ao gateway como arquivo (nunca URL); o proxy de mídia recebida só aceita caminhos `/media/<arquivo>` do próprio gateway; redirecionamentos são recusados.
- Anexos: lista de tipos permitidos, limite de tamanho (`MEDIA_MAX_BYTES`), nome em disco gerado pelo sistema.
- Exportação CSV neutraliza fórmulas de planilha.
- Gateway: sem credenciais padrão, admin e chave de API provisionados por variáveis obrigatórias, Swagger público desligado, banco e usuário próprios, `prisma db push` sem `--accept-data-loss`.
- Auditoria (`audit_log`) de ações comerciais: configuração, ofertas, varreduras, campanhas, público, mensagens manuais, cancelamentos, supressões, etapas, propostas, pagamentos, exportações.

## Primeira abordagem sem opt-in

Decisão operacional do proprietário. **Não** equivale a conformidade com a política do WhatsApp nem com a LGPD. O sistema exige identificação do remetente, origem do contato, motivo, pergunta de permissão e recusa simples no modelo; recusas são permanentes e prioritárias.

## Retenção, exportação e exclusão

| Dado | Retenção sugerida | Como |
| --- | --- | --- |
| Leads sem interação | 12 meses sem nova coleta | revisar pela Base de leads (filtro, exportação) e excluir conforme abaixo |
| Conversas e mensagens | enquanto houver relação comercial + 24 meses | |
| Supressões (recusas) | **indefinida** | necessária para nunca mais abordar quem recusou |
| Propostas e pagamentos | prazo fiscal aplicável (5 anos) | |
| Backups | 30 dias (rotação) | apagar cópias antigas cifradas |
| Webhooks brutos (`webhook_events`) | 90 dias | `DELETE FROM webhook_events WHERE processed_at < NOW() - INTERVAL 90 DAY;` |

Exportação: **Base de leads** › filtros › `GET /api/leads/export.csv` (mesmos filtros), além dos backups completos.

Exclusão a pedido do titular (procedimento manual, registre na auditoria): manter a supressão do telefone (para não abordar de novo) e apagar o restante:

```sql
-- Substitua :phone_id. Faça backup antes.
DELETE m FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.phone_id = :phone_id;
DELETE FROM conversations WHERE phone_id = :phone_id;
UPDATE companies SET notes = NULL WHERE id IN (SELECT company_id FROM company_phones WHERE phone_id = :phone_id);
```

Mídias recebidas permanecem no volume do gateway; remova-as pelo painel do WA-AKG se necessário. **Pendência:** automatizar exclusão/anonimização por titular na interface.

# aero — instruções para agentes

Aplicação pessoal (um único operador e um único número de WhatsApp) para prospecção, campanhas, atendimento e oportunidades. Leia o [README](README.md) e [docs/arquitetura.md](docs/arquitetura.md) antes de mudanças estruturais.

## Regras invioláveis

- **Nunca envie mensagens reais nem ative campanhas** em testes sem pedido explícito do proprietário. Testes usam fakes (`apps/api/test/helpers.ts`) e o banco `aero_test`.
- Não rode varreduras extensas contra o Google Maps para "demonstrar"; use o CSV de `apps/api/test/fixtures`.
- Não versione segredos, `.env`, backups, dados de leads, mídias ou sessões do WhatsApp.
- Não exponha portas fora de `127.0.0.1`; o teste `routes.test.ts` e o CI verificam isso.
- Coletar/validar nunca dispara envio. Recusa/supressão é permanente e prioritária. Resultado de envio desconhecido não é reenviado automaticamente.
- Não altere o logotipo (`assets/brand`); use a versão preta em fundo claro e a branca em fundo escuro.
- Frontend: por ora, apenas correções funcionais, de tipos, acessibilidade e React Doctor; o visual será refeito depois.

## Convenções

- Node 24 com type stripping: imports com extensão `.ts`, sem `enum`/parameter properties (`erasableSyntaxOnly`).
- API: Fastify 5 + TypeBox 1.x (`StringEnum`, `Merge`, `Nullable` em `src/lib/schemas.ts`); erros com `AppError`; regras de negócio nos serviços dos módulos; integrações só via `src/integrations/*`.
- Banco: Drizzle; altere `src/db/schema.ts` e gere migration com `npm run db:generate` (nunca edite migrations já aplicadas). Dinheiro em centavos + moeda; datas em UTC.
- Toda ação que precisa de fila grava no `outbox` dentro da transação de negócio (`core/outbox.ts`).
- Textos de interface em português do Brasil; rótulos de estado em `packages/shared/src/labels.ts`.
- Skills do projeto: `.claude/skills/fastify` e `.claude/skills/react-doctor`.

## Verificação

`npm run verify` (tipos, lint, testes, build, React Doctor). Testes da API precisam do MySQL (`docker compose -f docker-compose.yml -f compose.dev.yml up -d mysql`).

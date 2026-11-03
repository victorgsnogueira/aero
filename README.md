# aero

Aplicação pessoal para prospecção de empresas, campanhas comerciais, atendimento pelo WhatsApp e acompanhamento de oportunidades (landing pages e sistemas sob medida). Uso exclusivo do proprietário, com um único número de WhatsApp.

Fluxo: **captação** (Google Maps Scraper) → **validação** de WhatsApp (WA-AKG) → **campanhas** → **mensagens e qualificação** → **atendimento humano** → **oportunidades, propostas e pagamentos** → **indicadores**.

> Coletar ou validar contatos **nunca** envia mensagens. Envios ocorrem ao ativar campanha ou solicitar envio manual, respeitando elegibilidade e `SENDING_ENABLED=true`.

## Iniciar a partir de um clone limpo (Docker)

Requisitos: Docker Desktop/Engine com Compose v2, Node.js 24 (apenas para gerar os segredos) e Git.

```bash
git clone https://github.com/victorgsnogueira/aero.git
```

```bash
cd aero && node infra/scripts/gen-secrets.mjs
```

```bash
docker compose up -d --build
```

Acesse **http://localhost:8080**. A primeira subida compila o gateway WA-AKG a partir de um commit fixado e pode levar alguns minutos.

Depois:

1. **Configurações › Operação**: seu nome e o nome da sua empresa (obrigatórios para enviar).
2. **Ofertas**: cadastre ao menos uma oferta.
3. **Configurações › Conexão do WhatsApp**: “Preparar sessão”, “Conectar” e leia o QR code no celular.
4. **Varreduras** → **Base de leads** → **Campanhas**.
5. Para testar envios, use `SEND_ALLOWLIST` com números seus e só então `SENDING_ENABLED=true` no `.env` (seguido de `docker compose up -d`).

Dados de demonstração (fictícios, marcados `[DEMO]`, nunca abordados): `docker compose exec api node src/db/seed-demo.ts` (remover: acrescente `--remove`).

## Desenvolvimento

```bash
npm ci
```

```bash
docker compose -f docker-compose.yml -f compose.dev.yml up -d mysql redis scraper wa-gateway
```

```bash
npm run db:migrate
```

Em terminais separados: `npm run dev:api`, `npm run dev:worker`, `npm run dev:web` (Vite em http://localhost:5173, com proxy de `/api`). Os webhooks do gateway só alcançam a API quando ela roda no Docker (ver [docs/operacao.md](docs/operacao.md)).

Verificação completa (tipos, lint, testes, build, React Doctor):

```bash
npm run verify
```

Os testes de integração usam um banco MySQL **real e isolado** (`aero_test`) e fakes do scraper e do gateway — nenhum teste fala com o WhatsApp.

## Estrutura

```
apps/api        Fastify + TypeBox + Drizzle (API: src/server.ts, worker BullMQ: src/worker.ts)
apps/web        Vite 8 + React 19 + Tailwind 4 + daisyUI 5 + TanStack Query + MapLibre
packages/shared Estados, rótulos pt-BR, dinheiro em centavos e renderização de modelos
infra/          Gateway WA-AKG (Dockerfile fixado), MySQL init, Caddy, scripts, VPS
docs/           Arquitetura, operação, backup, VPS/Tailscale, segurança, testes, OpenAPI
assets/brand    Logotipo aprovado (versões preta e branca, PNG/SVG/favicon fornecidos)
```

## Documentação

- [Arquitetura, decisões e versões](docs/arquitetura.md)
- [Operar pelo chat com MCP: configuração, ferramentas e exemplos](docs/mcp.md)
- [Operação: WhatsApp, scraper, envio, diagnóstico e recuperação](docs/operacao.md)
- [Backup, restauração e migração](docs/backup-restauracao.md)
- [VPS da Hostinger com Tailscale](docs/vps-tailscale.md)
- [Segurança, dados pessoais, retenção e exclusão](docs/seguranca-dados.md)
- [Testes, cenários verificados e pendências](docs/testes.md)
- [Frontend: contrato com a API × apresentação](docs/frontend.md)
- API: `/api/docs` (Swagger UI) e [docs/openapi.json](docs/openapi.json)

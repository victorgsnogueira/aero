# Frontend: contrato com a API × apresentação

O visual de `apps/web` pode ser refeito livremente. Para não quebrar o funcionamento, preserve o **contrato** abaixo e substitua à vontade a **apresentação**.

## Contrato (manter estável)

| Arquivo | Por quê |
| --- | --- |
| `src/main.tsx` — rotas e `QueryClient` | URLs usadas em links internos, redirecionamentos e documentação (`/inbox/:id`, `/campanhas/:id?aba=…`, `/configuracoes/whatsapp` etc.). |
| `src/lib/api.ts` | Envia `X-Aero-Request: 1` em toda escrita (proteção CSRF exigida pela API), trata erros (`ApiError`) e monta query strings. |
| `src/lib/types.ts` | Formato das respostas da API. |
| `src/lib/live.ts` | SSE `/api/events` e chaves de consulta invalidadas (`scans`, `leads`, `inbox`, `campaigns`, `opportunities`, `wa-session`, `attention`). Ao renomear chaves de consulta, ajuste aqui. |
| `src/lib/useLeadFilters.ts` | Filtros da base de leads e do mapa na URL (nomes dos parâmetros iguais aos da API). |
| `src/lib/format.ts`, `src/lib/offer.ts`, `src/lib/numbers.ts` | Formatação de dinheiro por moeda (centavos, nunca float), preços de oferta e leitura segura de números. |
| `@aero/shared` (`packages/shared`) | Estados, rótulos em pt-BR, dinheiro e renderização de modelos (a mesma usada no envio). |
| Chamadas `useQuery`/`useMutation` dentro das páginas | Hoje ficam junto do JSX em `src/pages/*.tsx`. Ao redesenhar uma página, mantenha os mesmos endpoints, payloads, `queryKey` e invalidações. Também mantenha o `clientKey` do envio manual (idempotência) e a confirmação antes de ativar/cancelar campanha e desvincular o WhatsApp. |
| `src/pages/MapPage.tsx` — inicialização do MapLibre | `setWorkerUrl` com `?worker&url` e `worker.format: 'es'` em `vite.config.ts` são necessários para o mapa funcionar com o Vite. Mantenha também a consulta por área visível (`/leads/map`) e a atribuição do OpenFreeMap. |

## Apresentação (livre para trocar)

- `src/index.css`: tema daisyUI, cores, tipografia e espaçamentos.
- `src/components/*`: layout, navegação, badges, modais, campos, toasts e editor de modelos. Mantenha as regras de acessibilidade (rótulos, foco visível, `aria-*`).
- O JSX e as classes das páginas em `src/pages/*.tsx` (estrutura, cards, títulos e textos de apoio).
- Logotipo: use apenas os arquivos de `public/brand` (versão preta em fundo claro, branca em fundo escuro) sem alterar o desenho.

## Verificação depois do redesenho

```bash
npm run typecheck -w @aero/web
```

```bash
npm run lint -w @aero/web
```

```bash
npm run doctor -w @aero/web
```

O CI roda o React Doctor e bloqueia diagnósticos de erro.

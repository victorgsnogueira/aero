# Frontend: contrato com a API × apresentação

O visual de `apps/web` pode ser refeito livremente. Para não quebrar o funcionamento, preserve o **contrato** abaixo e substitua à vontade a **apresentação**.

## Contrato (manter estável)

| Arquivo | Por quê |
| --- | --- |
| `src/main.tsx` — rotas e `QueryClient` | URLs usadas em links internos, redirecionamentos e documentação (`/inbox/:id`, `/campanhas/:id?aba=…`, `/configuracoes/whatsapp` etc.). |
| `src/lib/api.ts` | Envia `X-Aero-Request: 1` em toda escrita (proteção CSRF exigida pela API), trata erros (`ApiError`) e monta query strings. |
| `src/lib/types.ts` | Formato das respostas da API. |
| `src/lib/live.ts` | SSE `/api/events` e chaves de consulta invalidadas (`scans`, `leads`, `inbox`, `campaigns`, `opportunities`, `wa-session`, `attention`, `metrics`). Ao renomear chaves de consulta, ajuste aqui. |
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

### Interface compacta e correções visuais (17/10/2026)

A direção fornecida pelo proprietário, inspirada no Linear, foi aplicada com o Impeccable em modo Operate:

- Texto compacto de 13 px, espaçamento entre letras de -0,01 em e linhas simples de 32 px. Os controles de formulário e botões têm alvos maiores para ponteiros de toque.
- Três superfícies planas por tema, bordas discretas e nenhuma sombra decorativa. Hover em 80 ms; transições de estado em até 120 ms.
- Um único destaque índigo para ação principal e seleção; estados representados por ícone e texto neutros.
- Grade de espaçamento de 4 px, ícones de 16 px e valores numéricos alinhados à direita. Source Sans 3 e Manrope são fontes locais com licenças OFL.
- Visão geral com próxima ação ou fila de pendências em primeiro plano, acompanhamento comercial em segundo e indicadores detalhados em relatórios expansíveis. Falhas nas consultas de atenção nunca são apresentadas como ausência de pendências.

A pedido posterior do proprietário, os atalhos de navegação e sua ajuda foram removidos. O compositor mantém o comportamento habitual de Enter e Shift+Enter sem exibir as legendas de atalhos.

A tabela de leads usa uma grade de colunas estável, que não se redimensiona ao ordenar ou paginar. Os filtros de data reservam espaço para o calendário e se redistribuem conforme a largura disponível.

A tabela de leads tem seleção de todos os registros da página, seleção parcial e ordenação crescente/decrescente por qualquer coluna. A API ordena o conjunto filtrado antes de paginar, com desempate por ID, mantendo compatibilidade com os parâmetros anteriores.

Corrigidos os textos sobrepostos na tabela de leads, a reserva de espaço para a seta dos seletores, o contorno duplicado da busca e o foco excessivamente claro dos seletores. O check usa cor oposta ao preenchimento nos dois temas. O estado inicial da visão geral em 1440 × 900 ocupa a janela sem rolagem adicional; conteúdo expandido e telas menores continuam rolando quando necessário.

A barra superior usa botão de sol/lua com preferência persistida; o indicador de conexão foi removido do topo. A caixa de entrada ocupa a altura útil da janela sem rolagem externa. Lista e mensagens rolam em suas próprias áreas; detalhes ficam ao lado em telas largas e abrem em painel nas demais. A chegada de mensagens ajusta somente a rolagem da região de mensagens.

Os comentários explicativos foram removidos do código próprio, testes, CSS, scripts e configurações. Marcadores operacionais de migração, shebangs, licenças e literais necessários ao patch de dependência foram preservados. As alterações fora da interface preservam o código executável, com retornos explícitos nos catches anteriormente documentados em `core/events.ts`.

Validação: tipos, lint, 52 testes de API, 4 compartilhados e 33 do frontend, build e React Doctor. As verificações de API usam fakes e banco de teste. Nenhuma mensagem real foi enviada nem campanha ativada.

### Consultas, buscas e cache

Todas as consultas do TanStack Query encaminham o `AbortSignal` ao cliente HTTP. Consultas sem observadores podem ser canceladas ao trocar filtros, paginação ou tela; consultas ainda compartilhadas por componentes ativos continuam disponíveis. Escritas preservam os contratos e o comportamento anterior.

A busca da caixa de entrada aplica o texto após 300 ms e reinicia a paginação na mesma atualização. A cidade da visão geral aguarda 350 ms; datas e seletores continuam imediatos. O debounce da busca de leads usa o callback atual sem reiniciar quando o componente pai renderiza novamente.

O mapa cancela as consultas anteriores ao carregar outra área, alterar filtros, trocar o tema ou desmontar. Movimentar o mapa também cancela enquadramentos pendentes. Mesmo que uma resposta cancelada conclua, ela não altera os pontos, o enquadramento, o erro ou o indicador de carregamento da consulta atual.

A lista do mapa apresenta nome, status do WhatsApp e etapa comercial a partir da mesma resposta de `/leads/map`, sem consultar cada lead separadamente. Clicar no nome localiza o ponto; a ação lateral abre o cadastro existente. A seleção é indicada na própria linha. O texto de contagem e coordenadas acima da lista foi removido; carregamento, área vazia e agrupamentos têm estados específicos.

Eventos SSE de coleta, validação, campanhas, conversas, mensagens e oportunidades invalidam as métricas correspondentes, incluindo as comparações por campanha. As invalidações são agrupadas em lotes de 250 ms. Após reconectar o SSE, o cache é invalidado para recuperar mudanças ocorridas durante a desconexão. Consultas ativas são atualizadas; as inativas ficam marcadas para atualização no próximo uso.

Testes de regressão cobrem debounce, reinício de página, cancelamento de fetch, respostas em ordem invertida, enquadramento do mapa, atualização de consultas ativas e recuperação após reconexão.

### Comandos

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

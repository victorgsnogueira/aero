---
name: aero
description: Interface de operação compacta, precisa, consistente e rápida.
colors:
  primary: "#5362c6"
  primary-dark: "#7886f0"
  canvas: "#f5f6f8"
  panel: "#ffffff"
  hover: "#edeef2"
  text: "#24252b"
  text-secondary: "#666975"
  line: "rgba(24, 25, 31, 0.13)"
  canvas-dark: "#111216"
  panel-dark: "#17181c"
  hover-dark: "#202127"
  text-dark: "#e7e8ed"
  text-secondary-dark: "#a3a5b0"
  line-dark: "rgba(255, 255, 255, 0.11)"
typography:
  headline:
    fontFamily: "Manrope, Segoe UI, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: "28px"
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Manrope, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 600
  dialog-title:
    fontFamily: "Manrope, Segoe UI, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Source Sans 3, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "-0.01em"
  label:
    fontFamily: "Source Sans 3, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 400
  total:
    fontFamily: "Manrope, Segoe UI, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: "32px"
rounded:
  control: "4px"
  container: "6px"
  checkbox: "3px"
spacing:
  unit: "4px"
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "20px"
  xl: "24px"
  xxl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.panel}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "32px"
  button-secondary:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "32px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "32px"
  input:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "0 8px"
    height: "32px"
  navigation-item:
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.control}"
    padding: "0 8px"
    height: "32px"
  status-label:
    textColor: "{colors.text-secondary}"
    typography: "{typography.body}"
  record-container:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.control}"
  lead-table:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
---

# Design System: aero

## Overview

**Creative North Star: "Interface compacta, precisa, consistente e rápida"**

A direção confirmada pelo proprietário parte das cinco decisões que ele forneceu sobre o Linear. A interface de operação usa densidade, peso tipográfico, superfícies planas e ícones para tornar o próximo trabalho reconhecível. Informações de apoio permanecem disponíveis sem disputar a mesma atenção.

Este é um sistema derivado do código. Novas telas devem continuar seus componentes e contratos visuais; uma composição no Figma não é requisito. A composição específica da Visão geral permanece em `.impeccable/surfaces/overview.md`.

**Key Characteristics:**
- Densidade compacta com hierarquia explícita.
- Três superfícies planas por tema e um único destaque índigo.
- Estados por ícone e texto neutros.
- Números e datas alinhados à direita.
- Respostas curtas e alvos maiores no toque.

## Colors

A paleta combina neutros discretos com índigo reservado à seleção e à ação principal. Os tokens sem sufixo representam o tema claro; os de sufixo `-dark`, o escuro. Na implementação, as mesmas variáveis semânticas mudam com `data-theme`.

### Primary

- **Índigo de ação** (`primary` / `primary-dark`): ação principal, item de navegação selecionado e seleção de linhas. Seleções usam mistura de 12% com transparência; hover da ação usa mistura de 90% do índigo com o texto principal. O texto sobre índigo é branco no claro e o tom do canvas no escuro.

### Neutral

- **Canvas** (`canvas` / `canvas-dark`): fundo da área de trabalho e barra superior.
- **Painel** (`panel` / `panel-dark`): navegação, campos, listas e contêineres de dados.
- **Interação** (`hover` / `hover-dark`): hover, cabeçalho de tabela e apoio tonal.
- **Texto principal** (`text` / `text-dark`): conteúdo, títulos e controles.
- **Texto de apoio** (`text-secondary` / `text-secondary-dark`): metadados, estados, ícones auxiliares e contorno de campos em foco.
- **Divisória** (`line` / `line-dark`): separação sutil entre áreas e registros.

**The Single Accent Rule.** Use o índigo para seleção e ação principal; comunique estados com ícone e texto neutros.

## Typography

**Display Font:** Manrope, com Segoe UI e sans-serif como alternativas; aplicada aos títulos, sem papel de display promocional.

**Body Font:** Source Sans 3, com Segoe UI e sans-serif como alternativas. As duas famílias são servidas localmente em WOFF2.

O corpo é compacto e contínuo; títulos marcam níveis sem ampliar toda a tela. A hierarquia normativa está no frontmatter: `headline` para título de página, `title` para seções, `dialog-title` para diálogos, `body` para operação, `label` para apoio e `total` para o total financeiro em destaque. Nomes de registros e seções densas também usam corpo com peso semibold (600). Conversas usam texto de leitura ligeiramente maior (14px, entrelinha 1,5).

**The Comparable Data Rule.** Alinhe números e datas à direita; use algarismos tabulares nas medidas e contagens comparáveis.

## Layout

A unidade espacial é de quatro pixels. Controles e linhas simples partem de 32px; conteúdo essencial pode ampliar a linha. Ícones vetoriais medem 16px, com traço de 1,5 no viewBox de 24. A navegação lateral tem 224px; a barra superior tem mínimo de 40px. O conteúdo recebe 24px de margem interna, 24px por 32px em telas largas e 16px no compacto.

No breakpoint de 48rem, grades de apoio ganham duas colunas. Em 64rem, a navegação fica aberta e espaços como caixa de entrada e mapa ganham áreas laterais. Em 90rem, a conversa ganha contexto ao lado; antes disso, os detalhes abrem por um botão em painel sobreposto. A caixa de entrada ocupa a altura disponível, com rolagem interna na lista, nas mensagens e no contexto. Outras áreas de apoio empilham; tabelas preservam largura mínima de 768px e rolagem horizontal no próprio contêiner. A Visão geral limita sua largura a 1480px sem transformar esse limite em obrigação para todas as telas.

Com `pointer: coarse`, botões, navegação, campos, ordenação e linhas de ação têm alvo mínimo de 40px. Cabeçalhos e filtros podem quebrar em várias linhas. Preserve rótulos acessíveis e a navegação por teclado.

## Elevation & Depth

Não há sombras decorativas. A profundidade vem da troca entre canvas, painel e superfície de interação, acompanhada de bordas finas (1px). Navegação, barra fixa, drawer e diálogo usam posicionamento e camadas funcionais. Os contêineres não devem se multiplicar para dar o mesmo peso a toda informação.

**The Flat Surface Rule.** Diferencie áreas por tom, espaço e divisórias; preserve sombras desativadas em botões, diálogos e controles de mapa.

A lista lateral do mapa trata cada linha como um lead: nome em destaque, status do WhatsApp e etapa comercial quando disponível. Localizar no mapa e abrir o cadastro são ações separadas. A seleção usa a superfície índigo existente, sem criar um cartão extra acima da lista. O painel mede 320px no desktop e empilha abaixo do mapa em telas menores.

No mapa, cores funcionais distinguem os estados do WhatsApp: verde para encontrado, vermelho para não encontrado, âmbar para inconclusivo, roxo para formato inválido e azul para pendente. Pontos e legenda usam a mesma paleta; agrupamentos continuam neutros porque podem reunir estados diferentes. Esta é uma exceção ao uso de estados neutros nas demais telas.

## Shapes

Predominam retângulos discretamente arredondados: controles e contêineres de registros usam `control`; diálogos e faixa de prioridade usam `container`; checkboxes usam `checkbox`. Estados são rótulos abertos, sem fundo, borda ou formato de pill. Ícones usam SVG de traço uniforme. Preserve o símbolo aprovado: preto em fundo claro e branco em fundo escuro, sem redesenho.

## Components

### Buttons

Botões compactos, com intervalo de 8px entre ícone e texto. O principal usa índigo; o secundário usa painel e divisória; o ghost permanece transparente até a interação. Hover e active mudam a cor sem deslocar, escalar ou levantar. Desabilitado usa superfície de interação, texto secundário e opacidade de 0,45.

Hover de cor responde em 80ms com `ease-out`; opacidade, drawer e diálogo usam 120ms. Respeite `prefers-reduced-motion`.

### Inputs / Fields

Campos e selects compartilham forma, superfície e densidade. Select reserva 28px à direita. Rótulo permanece associado ao campo; ajuda e erro são apoio textual, com ícone quando necessário. Busca composta desenha um único foco no contêiner, sem segundo contorno no input interno.

**The Field Focus Rule.** Campos, selects e textareas usam contorno de 1px em texto secundário, sem offset, inclusive `select:open`. Botões e links conservam foco visível de teclado de 2px em texto principal com offset de 2px.

### Navigation

Itens usam ícone e rótulo, texto de apoio em repouso e fundo de interação no hover. O item atual usa índigo e seleção tonal. Contagens são discretas, tabulares e à direita. Em telas menores, a navegação abre em drawer e fecha na mudança de rota. Não há atalhos de navegação nem painel de ajuda para atalhos. O topo tem um botão de sol/lua para alternar e persistir o tema; o indicador de conexão do WhatsApp foi retirado desse local.

### Status labels

Ícone e texto neutros distinguem andamento, conclusão, alerta, pausa e cancelamento. O rótulo continua legível sem cor; nunca use somente o ícone para transmitir o estado. Não há pills coloridas.

### Cards / Containers

Listas e tabelas compartilham painel, divisória e canto discreto. Linhas sucessivas substituem cards individuais quando representam o mesmo conjunto. Estados vazios mantêm texto direto e ação contextual. O sistema admite contêineres e itens de pipeline; a restrição confirmada é seu uso excessivo.

### Lead table

A tabela mantém dados compactos, hover neutro, cabeçalho tonal e elipse com título para nomes longos. A grade usa layout fixo e larguras proporcionais por coluna; ordenar ou paginar não recalcula larguras pelo conteúdo. Abaixo da largura mínima, a rolagem horizontal permanece na região da tabela. Telefones e datas ficam à direita. Seleção de linhas usa índigo tonal; checkbox preenchido usa texto principal e marca inversa à superfície do preenchimento.

O checkbox do cabeçalho seleciona somente a página corrente e informa seleção parcial com `indeterminate` e `aria-checked="mixed"`. Enquanto exibe dados provisórios na troca de página ou ordenação, a tabela informa `aria-busy` e desabilita checkboxes. Cada coluna ordenável é um botão, com `aria-sort` no cabeçalho; ícones neutros mostram direção e ganham contraste em hover ou ordenação ativa.

## Do's and Don'ts

### Do:

- **Do** use três superfícies por tema e reserve o índigo à seleção e à ação principal.
- **Do** mantenha linhas simples compactas e amplie alvos de interação no toque.
- **Do** alinhe números e datas à direita e use algarismos tabulares para comparação.
- **Do** diferencie prioridade, conteúdo principal e apoio pelo peso, espaço e posição.
- **Do** preserve foco visível, estados textuais, rótulos acessíveis e movimento reduzido.
- **Do** preserve as fontes locais, o nome aero e o símbolo aprovado nos dois temas.

### Don't:

- **Don't** dê o mesmo peso a todos os indicadores nem transforme cada informação em card.
- **Don't** adicione descrições genéricas ao topo de páginas.
- **Don't** introduza sombras decorativas ou pills coloridas de estado.
- **Don't** adicione atalhos de navegação ou ajuda de atalhos.
- **Don't** use contorno excessivamente claro nem foco duplo em campos e selects.
- **Don't** use cor como único sinal de estado ou esconda dados essenciais para preservar altura fixa.

# aero

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Um único proprietário, que opera prospecção e atendimento comercial pelo próprio computador e número de WhatsApp.

## Product Purpose

Reunir captação de empresas, validação de telefones, campanhas independentes, conversas, oportunidades, propostas e pagamentos. O operador deve reconhecer o próximo trabalho e executá-lo sem perder o contexto comercial.

## Operating Context

Uso frequente em um aplicativo de operação, inicialmente local em Docker. Futuro acesso privado em VPS via Tailscale. Serviços vendidos: landing pages e sistemas sob medida. Coleta pelo Google Maps Scraper; WhatsApp integrado via WA-AKG.

## Capabilities and Constraints

- Coletar ou validar não envia mensagens. Ativação de campanhas e envio real dependem de ação expressa do proprietário.
- Preservar contratos da API, rotas, filtros, atualização por SSE, idempotência de envio e confirmações das ações relevantes.
- Supressão permanente, atendimento humano e estados reais de envio continuam prioritários.
- Proposta aceita e pagamento confirmado são eventos distintos. Valores são separados por moeda.
- Texto e rótulos em português do Brasil; navegação por teclado e responsividade.
- Não inventar métricas ou apresentar dados de demonstração como reais.

## Brand Commitments

Nome aero e símbolo aprovado em `assets/brand`, sem redesenho. Versão preta em fundo claro e branca em fundo escuro.

## Product Principles

- Tornar a prioridade de trabalho explícita antes de apresentar estatísticas.
- Manter informações de apoio disponíveis sem competir com a tarefa principal.
- Interface compacta, precisa, consistente e rápida, conforme direção explícita do proprietário de 17/10/2026, inspirada no Linear.

## Evidence on Hand

README, `docs/arquitetura.md`, `docs/frontend.md`, contratos e telas existentes. Decisões e restrições confirmadas pelo proprietário neste chat. Não há autorização para enviar mensagens reais ou ativar campanhas durante revisão visual.

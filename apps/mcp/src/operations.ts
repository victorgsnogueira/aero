import * as z from 'zod/v4';
import type { AeroApi } from './api.ts';
import { createFiles, RichResult } from './files.ts';
import * as s from './schemas.ts';
import * as o from './operation-schemas.ts';

export type ToolRegistrar = <S extends z.ZodRawShape>(name: string, description: string, schema: z.ZodObject<S>, readOnly: boolean, handler: (args: z.output<z.ZodObject<S>>, signal: AbortSignal) => Promise<unknown>, idempotent?: boolean) => void;

export function registerOperations(tool: ToolRegistrar, api: AeroApi, filesRoot?: string) {
  const empty = z.object({});
  const get = (path: string, query?: Record<string, string | number | boolean | undefined>, signal?: AbortSignal) => api.request(path, { query, signal });
  const post = (path: string, body?: unknown, signal?: AbortSignal) => api.request(path, { method: 'POST', body, signal });
  const files = createFiles(filesRoot);

  tool('aero_settings_get', 'Consulta identidade do remetente, empresa, fuso, limites, parâmetros de coleta/validação e interruptores de envio.', empty, true, (_, signal) => get('/settings/', undefined, signal));
  tool('aero_settings_update', 'Altera somente os campos informados das configurações da operação. Pode cadastrar remetente/empresa e ajustar limites quando solicitado; não altera SENDING_ENABLED nem allowlist do ambiente.', z.object({ patch: o.settingsPatch }), false, ({ patch }, signal) => api.request('/settings/', { method: 'PATCH', body: patch, signal }), true);
  tool('aero_offer_get', 'Consulta todos os campos de uma oferta para editar sem perder dados.', s.ids, true, ({ id }, signal) => get(`/offers/${id}`, undefined, signal));
  tool('aero_offer_create', 'Cadastra oferta de landing_page ou micro_saas. Dinheiro em centavos inteiros; fixed/starting_at exige priceCents.', o.offerCreate, false, (body, signal) => post('/offers/', body, signal));
  tool('aero_offer_update', 'Substitui a oferta. Consulte aero_offer_get e envie todos os campos editáveis, preservando os demais. Snapshots já apresentados não mudam.', z.object({ id: s.id, offer: o.offerBody }), false, ({ id, offer }, signal) => api.request(`/offers/${id}`, { method: 'PUT', body: offer, signal }), true);
  tool('aero_offer_archive', 'Arquiva oferta, preservando histórico e snapshots.', s.ids, false, ({ id }, signal) => post(`/offers/${id}/archive`, undefined, signal), true);

  tool('aero_lead_create', 'Cadastra empresa manualmente com dados comerciais/geográficos e até 20 telefones. Reutilize clientKey para o mesmo cadastro; telefones são normalizados e deduplicados sem perder validação ou supressões. Não valida nem envia automaticamente.', o.leadCreate, false, (body, signal) => post('/leads/', body, signal), true);
  tool('aero_lead_update', 'Altera os campos informados da empresa, preservando fonte, telefones, validações e histórico. Não permite declarar WhatsApp confirmado manualmente.', z.object({ id: s.id, patch: o.leadPatch }), false, ({ id, patch }, signal) => api.request(`/leads/${id}`, { method: 'PATCH', body: patch, signal }), true);
  tool('aero_lead_add_phone', 'Vincula telefone à empresa usando normalização/deduplicação. Números compartilhados mantêm a mesma validação/supressão e histórico. Não envia.', z.object({ id: s.id, phone: z.string().trim().min(1).max(64), countryCode: z.string().regex(/^[A-Z]{2}$/).nullable().optional() }), false, ({ id, ...body }, signal) => post(`/leads/${id}/phones`, body, signal), true);
  tool('aero_lead_facets', 'Lista cidades e categorias cadastradas para selecionar filtros existentes.', empty, true, (_, signal) => get('/leads/facets', undefined, signal));
  tool('aero_leads_export', 'Exporta os leads filtrados em CSV para arquivo local em exports/mcp. Até 50.000 linhas, conforme API; retorna o caminho, sem despejar dados no chat.', z.object(s.filters), true, async (query, signal) => {
    const csv = await api.request('/leads/export.csv', { query, signal, responseType: 'text' }) as string;
    return { filePath: await files.save(csv, 'csv'), limit: 50000 };
  });
  tool('aero_phone_unsuppress', 'Remove apenas bloqueio manual de operação quando solicitado e justificado. A API proíbe remover recusa/descadastro ou supressão associada a mensagem do contato. Não reativa campanhas ou reenvia mensagens.', z.object({ phoneId: s.id, reason: z.string().trim().min(3).max(255) }), false, ({ phoneId, reason }, signal) => post(`/leads/phones/${phoneId}/unsuppress`, { reason }, signal), true);

  tool('aero_scan_recount', 'Recalcula os contadores de uma varredura a partir dos registros existentes, sem executar nova coleta.', s.ids, false, ({ id }, signal) => post(`/scans/${id}/recount`, undefined, signal), true);
  tool('aero_campaign_remove_audience', 'Remove participantes selecionados do público pelo ID de participação (não companyId/phoneId). Limites e estados são verificados pela API.', z.object({ id: s.id, ids: z.array(s.id).min(1).max(1000) }), false, ({ id, ids }, signal) => post(`/campaigns/${id}/contacts/remove`, { ids }, signal));
  tool('aero_campaign_apply_template', 'Aplica o modelo atual às mensagens pendentes selecionadas por messageIds. Consulte aero_campaign_pending antes; não altera histórico enviado.', z.object({ id: s.id, messageIds: z.array(s.id).min(1).max(500) }), false, ({ id, messageIds }, signal) => post(`/campaigns/${id}/pending/apply-template`, { messageIds }, signal));
  tool('aero_campaign_add_audience_by_filter', 'Adiciona público pelos filtros explicitamente solicitados (até 5.000 empresas). Consulte aero_leads_list com os mesmos filtros para revisar o escopo. Não ativa nem envia.', z.object({ id: s.id, filters: z.object({ q: s.filters.q, scanId: s.filters.scanId, category: s.filters.category, city: s.filters.city, waStatus: s.filters.waStatus, formatStatus: s.filters.formatStatus, includeDemo: z.literal(false).default(false) }).refine((x) => Object.entries(x).some(([k, v]) => k !== 'includeDemo' && v !== undefined && v !== ''), 'Informe ao menos um filtro') }), false, ({ id, filters }, signal) => post(`/campaigns/${id}/contacts`, { filters }, signal));

  tool('aero_whatsapp_provision', 'Prepara a sessão WhatsApp e registra o webhook do aero. Não dispara campanhas.', empty, false, (_, signal) => post('/whatsapp/session/provision', undefined, signal));
  tool('aero_whatsapp_qr', 'Obtém o QR code de pareamento e o apresenta como imagem quando disponível. O proprietário precisa ler o QR no celular.', empty, true, async (_, signal) => {
    const qr = await get('/whatsapp/session/qr', undefined, signal) as { image: string | null; reason: string | null };
    const match = qr.image?.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\r\n]+)$/);
    return match ? new RichResult({ reason: qr.reason, available: true }, [{ type: 'image', mimeType: match[1]!, data: match[2]!.replace(/\s/g, '') }]) : qr;
  });
  tool('aero_whatsapp_session_action', 'Conecta, para, reinicia ou encerra o pareamento da sessão. logout exige confirm=true e novo pareamento. Não use reinício/desconexão sem pedido do proprietário.', z.object({ action: z.enum(['start', 'stop', 'restart', 'logout']), confirm: z.boolean().optional() }).refine((x) => x.action !== 'logout' || x.confirm === true, 'logout exige confirm=true'), false, ({ action, confirm }, signal) => post(`/whatsapp/session/${action}`, { confirm }, signal));
  tool('aero_whatsapp_diagnostics', 'Verifica scraper, gateway, webhook, interruptor e allowlist de envios, sem enviar mensagens.', empty, true, (_, signal) => get('/whatsapp/diagnostics', undefined, signal));

  tool('aero_conversation_open', 'Abre ou recupera conversa por phoneId já confirmado no WhatsApp. Não envia mensagens nem assume atendimento existente. Rejeita telefones suprimidos. Depois consulte a conversa e use aero_message_send quando solicitado.', z.object({ phoneId: s.id }), false, (body, signal) => post('/inbox/conversations', body, signal), true);
  for (const [action, route, label] of [['read', 'read', 'Marca como lida'], ['takeover', 'takeover', 'Assume atendimento humano e cancela mensagens automáticas pendentes'], ['resume_automation', 'resume-automation', 'Retoma explicitamente a automação']] as const) {
    tool(`aero_conversation_${action}`, `${label} da conversa.`, s.ids, false, ({ id }, signal) => post(`/inbox/conversations/${id}/${route}`, undefined, signal));
  }
  tool('aero_conversation_update', 'Atualiza estado permitido, notas e próxima ação da conversa. Para assumir atendimento use takeover; para retomar automação use resume_automation.', z.object({ id: s.id, patch: o.conversationPatch }), false, ({ id, patch }, signal) => api.request(`/inbox/conversations/${id}`, { method: 'PATCH', body: patch, signal }), true);
  tool('aero_message_send', 'ENVIO REAL: envia texto manual na conversa quando solicitado. Respeita bloqueios da API, assume atendimento humano e pausa automação. clientKey deve ser estável para impedir duplicação.', o.messageSend, false, ({ id, ...body }, signal) => post(`/inbox/conversations/${id}/messages`, body, signal), true);
  tool('aero_attachment_send', 'ENVIO REAL: envia documento/mídia local na conversa quando solicitado, até 16 MiB e dentro de AERO_MCP_FILES_ROOT. Informe MIME correto, legenda e clientKey estável. O arquivo é enviado ao WhatsApp.', o.attachmentSend, false, async ({ id, filePath, mimeType, caption, clientKey }, signal) => {
    const file = await files.read(filePath);
    const form = new FormData();
    // Fields precede the file because Fastify consumes multipart as a stream.
    form.set('caption', caption);
    form.set('clientKey', clientKey);
    form.set('file', new Blob([new Uint8Array(file.data)], { type: mimeType }), file.name);
    return post(`/inbox/conversations/${id}/attachments`, form, signal);
  }, true);
  tool('aero_message_update', 'Altera o texto de mensagem ainda agendada. A API impede alteração do histórico enviado.', z.object({ id: s.id, body: z.string().trim().min(1).max(4096) }), false, ({ id, body }, signal) => api.request(`/inbox/messages/${id}`, { method: 'PATCH', body: { body }, signal }), true);
  tool('aero_message_cancel', 'Cancela mensagem ainda agendada, sem cancelar a campanha inteira.', s.ids, false, ({ id }, signal) => post(`/inbox/messages/${id}/cancel`, undefined, signal));
  tool('aero_message_resolve_unknown', 'Registra a conclusão verificada pelo proprietário para um envio desconhecido: sent ou not_sent. Não envia nem reenvia. Nunca infira o resultado sem evidência.', z.object({ id: s.id, as: z.enum(['sent', 'not_sent']) }), false, ({ id, as }, signal) => post(`/inbox/messages/${id}/resolve-unknown`, { as }, signal));
  tool('aero_message_media', 'Obtém o anexo de uma mensagem e salva em exports/mcp; imagens compatíveis também são retornadas ao chat. Não busca URLs fornecidas pelo modelo.', s.ids, true, async ({ id }, signal) => {
    const media = await api.request(`/inbox/messages/${id}/media`, { signal, responseType: 'binary' }) as { mimeType: string; data: Uint8Array };
    const extension = ({ 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'video/mp4': 'mp4', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'text/plain': 'txt', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx' } as Record<string, string>)[media.mimeType] ?? 'bin';
    const result = { filePath: await files.save(media.data, extension), mimeType: media.mimeType, size: media.data.length };
    return new RichResult(result, /^image\/(png|jpeg|webp)$/.test(media.mimeType) ? [{ type: 'image', mimeType: media.mimeType, data: Buffer.from(media.data).toString('base64') }] : []);
  });

  tool('aero_opportunity_create', 'Cadastra oportunidade vinculada à empresa, serviço e opcionalmente conversa. Não envia mensagens.', o.opportunityCreate, false, (body, signal) => post('/opportunities/', body, signal));
  tool('aero_opportunity_update', 'Altera título, notas e próxima ação da oportunidade, sem mudar campos omitidos.', z.object({ id: s.id, patch: o.opportunityPatch }), false, ({ id, patch }, signal) => api.request(`/opportunities/${id}`, { method: 'PATCH', body: patch, signal }), true);
  tool('aero_opportunity_stage', 'Move oportunidade de etapa com motivo. won/lost registra o resultado comercial; não comprova recebimento de pagamento.', o.stageChange, false, ({ id, ...body }, signal) => post(`/opportunities/${id}/stage`, body, signal));
  tool('aero_proposals_list', 'Lista propostas, estados e valores recebidos, com paginação.', o.proposalList, true, (query, signal) => get('/opportunities/proposals', query, signal));
  tool('aero_proposal_create', 'Cadastra proposta em rascunho na oportunidade indicada por id. Valores em centavos. Não envia proposta ao cliente.', z.object({ id: s.id, proposal: o.proposalCreate }), false, ({ id, proposal }, signal) => post(`/opportunities/${id}/proposals`, proposal, signal));
  tool('aero_proposal_update', 'Substitui todos os campos editáveis de proposta em rascunho. Consulte aero_opportunity_get e preserve os demais campos. A API bloqueia propostas fora de rascunho.', z.object({ id: s.id, proposal: o.proposalBody }), false, ({ id, proposal }, signal) => api.request(`/opportunities/proposals/${id}`, { method: 'PUT', body: proposal, signal }), true);
  tool('aero_proposal_status', 'Registra estado comercial da proposta. sent registra envio realizado fora desta ação; não manda mensagem. accepted move oportunidade para won, mas não registra pagamento.', o.proposalStatus, false, ({ id, ...body }, signal) => post(`/opportunities/proposals/${id}/status`, body, signal));
  tool('aero_payment_create', 'Registra recebimento efetivo na proposta aceita indicada por id. Não cobra/transfere dinheiro. Informe moeda da proposta, valor em centavos e data/hora com fuso; confira histórico para evitar duplicação.', o.paymentCreate, false, ({ id, ...body }, signal) => post(`/opportunities/proposals/${id}/payments`, body, signal));
  tool('aero_payment_delete', 'Exclui registro de pagamento lançado por engano, pelo ID do pagamento. Não estorna dinheiro; consulte a oportunidade para recalcular e conferir valores recebidos.', s.ids, false, ({ id }, signal) => api.request(`/opportunities/payments/${id}`, { method: 'DELETE', signal }), true);
  tool('aero_metrics_campaigns', 'Consulta indicadores agrupados por campanha, usando os mesmos filtros de aero_metrics.', s.metricsInput, true, (query, signal) => get('/metrics/campaigns', query, signal));
}

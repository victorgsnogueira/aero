import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CAMPAIGN_TRANSITIONS, PARTICIPATION_STATUSES, PARTICIPATION_STATUS_LABELS, SERVICE_LABELS, type CampaignStatus, type ParticipationStatus } from '@aero/shared';
import { api, errorMessage } from '../lib/api';
import type { Campaign, CampaignContact, Offer, Paged, QualificationQuestion } from '../lib/types';
import { ErrorAlert, Field, Loading, Modal, PageHeader, Pagination, Stat } from '../components/ui';
import { CampaignStatusBadge, ParticipationBadge, WaBadge } from '../components/status';
import { TemplateEditor } from '../components/TemplateEditor';
import { useToast } from '../components/toast';
import { fmtDateTime, fmtNum } from '../lib/format';
import { offerPrice } from '../lib/offer';
import { intFromInput } from '../lib/numbers';

interface Detail {
  campaign: Campaign;
  offer: Offer | null;
  overlap: number;
  missingSettings: string[];
}

const TABS = [
  ['resumo', 'Resumo'],
  ['mensagens', 'Oferta e mensagens'],
  ['qualificacao', 'Qualificação'],
  ['horarios', 'Horários e limites'],
  ['publico', 'Público'],
  ['pendentes', 'Envios pendentes'],
] as const;

const ACTION_LABELS: Record<CampaignStatus, string> = { active: 'Ativar', paused: 'Pausar', completed: 'Concluir', cancelled: 'Cancelar', draft: 'Rascunho' };
const DAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

type Config = Pick<
  Campaign,
  | 'name'
  | 'objective'
  | 'offerId'
  | 'firstMessageTemplate'
  | 'presentationTemplate'
  | 'qualificationQuestions'
  | 'questionsPerMessage'
  | 'qualificationDoneTemplate'
  | 'declineAckTemplate'
  | 'timezone'
  | 'sendDays'
  | 'sendWindowStart'
  | 'sendWindowEnd'
  | 'dailyLimit'
  | 'noReplyCloseHours'
  | 'audienceFilters'
>;

const toConfig = (c: Campaign): Config => ({
  name: c.name,
  objective: c.objective,
  offerId: c.offerId,
  firstMessageTemplate: c.firstMessageTemplate,
  presentationTemplate: c.presentationTemplate,
  qualificationQuestions: c.qualificationQuestions,
  questionsPerMessage: c.questionsPerMessage,
  qualificationDoneTemplate: c.qualificationDoneTemplate,
  declineAckTemplate: c.declineAckTemplate,
  timezone: c.timezone,
  sendDays: c.sendDays,
  sendWindowStart: c.sendWindowStart,
  sendWindowEnd: c.sendWindowEnd,
  dailyLimit: c.dailyLimit,
  noReplyCloseHours: c.noReplyCloseHours,
  audienceFilters: c.audienceFilters,
});

export default function CampaignDetail() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['campaigns', 'detail', id], queryFn: () => api.get<Detail>(`/campaigns/${id}`) });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />;
  return <CampaignView key={q.data.campaign.id} detail={q.data} />;
}

function CampaignView({ detail }: { detail: Detail }) {
  const c = detail.campaign;
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab = params.get('aba') ?? 'resumo';
  const [cfg, setCfg] = useState<Config>(() => toConfig(c));
  const [dirty, setDirty] = useState(false);
  const [confirm, setConfirm] = useState<CampaignStatus | null>(null);
  const set = <K extends keyof Config>(k: K, v: Config[K]) => {
    setCfg((x) => ({ ...x, [k]: v }));
    setDirty(true);
  };
  const closed = c.status === 'completed' || c.status === 'cancelled';
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['campaigns'] });

  const save = useMutation({
    mutationFn: () => api.put<Campaign>(`/campaigns/${c.id}`, { ...cfg, objective: cfg.objective?.trim() || null }),
    onSuccess: () => {
      setDirty(false);
      invalidate();
      toast('success', 'Campanha salva. Envios já agendados não mudam sem sua revisão (aba Envios pendentes).');
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const transition = useMutation({
    mutationFn: (to: CampaignStatus) => api.post<Campaign>(`/campaigns/${c.id}/status`, { to }),
    onSuccess: (_d, to) => {
      invalidate();
      toast('success', `Campanha ${ACTION_LABELS[to].toLowerCase()}`);
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  const audience = Object.values(c.counts).reduce((a, b) => a + (b ?? 0), 0);
  return (
    <>
      <PageHeader
        title={c.name}
        description={
          <>
            {SERVICE_LABELS[c.service]} · {detail.offer ? `${detail.offer.name} (${offerPrice(detail.offer)})` : 'sem oferta definida'}
          </>
        }
        actions={
          <>
            <CampaignStatusBadge status={c.status} />
            {CAMPAIGN_TRANSITIONS[c.status].map((to) => (
              <button key={to} type="button" className={`btn btn-sm ${to === 'active' ? 'btn-primary' : to === 'cancelled' ? 'btn-error btn-outline' : ''}`} disabled={transition.isPending || dirty} onClick={() => setConfirm(to)}>
                {c.status === 'paused' && to === 'active' ? 'Retomar' : ACTION_LABELS[to]}
              </button>
            ))}
          </>
        }
      />
      {detail.missingSettings.length ? (
        <div role="alert" className="alert alert-warning alert-soft mb-4">
          Preencha em <Link to="/configuracoes" className="link">Configurações</Link>: {detail.missingSettings.join(', ')}. Sem isso a campanha não pode ser ativada.
        </div>
      ) : null}
      {dirty ? (
        <div className="alert alert-info alert-soft mb-4 flex flex-wrap justify-between">
          <span>Alterações não salvas.</span>
          <div className="flex gap-2">
            <button type="button" className="btn btn-sm" onClick={() => { setCfg(toConfig(c)); setDirty(false); }}>
              Descartar
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => save.mutate()} disabled={save.isPending}>
              Salvar
            </button>
          </div>
        </div>
      ) : null}
      <div role="tablist" className="tabs tabs-border mb-6 overflow-x-auto">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" type="button" aria-selected={tab === k} className={`tab whitespace-nowrap ${tab === k ? 'tab-active' : ''}`} onClick={() => setParams({ aba: k }, { replace: true })}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'resumo' ? (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Público" value={fmtNum(audience)} />
            <Stat label="Aguardando resposta" value={fmtNum(c.counts.awaiting_reply ?? 0)} />
            <Stat label="Em qualificação" value={fmtNum(c.counts.qualifying ?? 0)} />
            <Stat label="Qualificados" value={fmtNum(c.counts.qualified ?? 0)} />
            <Stat label="Com você (humano)" value={fmtNum(c.counts.handed_off ?? 0)} />
            <Stat label="Recusas" value={fmtNum(c.counts.declined ?? 0)} />
            <Stat label="Sem resposta (encerrados)" value={fmtNum(c.counts.closed_no_reply ?? 0)} />
            <Stat label="Bloqueados/inelegíveis" value={fmtNum(c.counts.blocked ?? 0)} />
          </div>
          {detail.overlap ? (
            <div className="alert alert-soft alert-info">
              {detail.overlap} telefone(s) deste público também estão em outras campanhas. Abordagens simultâneas ao mesmo contato são bloqueadas automaticamente.
            </div>
          ) : null}
          <Field label="Nome">{(fid) => <input id={fid} className="input w-full max-w-xl" value={cfg.name} disabled={closed} onChange={(e) => set('name', e.target.value)} />}</Field>
          <Field label="Objetivo">{(fid) => <textarea id={fid} className="textarea w-full max-w-xl" rows={2} value={cfg.objective ?? ''} disabled={closed} onChange={(e) => set('objective', e.target.value)} />}</Field>
          <dl className="grid max-w-xl grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-base-content/60">Início</dt>
            <dd>{fmtDateTime(c.startedAt)}</dd>
            <dt className="text-base-content/60">Pausada em</dt>
            <dd>{fmtDateTime(c.pausedAt)}</dd>
            <dt className="text-base-content/60">Encerrada em</dt>
            <dd>{fmtDateTime(c.endedAt)}</dd>
          </dl>
          <div className="flex gap-2">
            <Link to={`/inbox?campaignId=${c.id}`} className="btn btn-sm">
              Conversas da campanha
            </Link>
            <Link to={`/oportunidades?campaignId=${c.id}`} className="btn btn-sm">
              Oportunidades
            </Link>
          </div>
        </div>
      ) : null}

      {tab === 'mensagens' ? <MessagesTab campaign={c} cfg={cfg} set={set} disabled={closed} /> : null}
      {tab === 'qualificacao' ? <QualificationTab cfg={cfg} set={set} disabled={closed} campaignId={c.id} /> : null}
      {tab === 'horarios' ? <ScheduleTab cfg={cfg} set={set} disabled={closed} /> : null}
      {tab === 'publico' ? <AudienceTab campaign={c} /> : null}
      {tab === 'pendentes' ? <PendingTab campaignId={c.id} /> : null}

      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm ? `${c.status === 'paused' && confirm === 'active' ? 'Retomar' : ACTION_LABELS[confirm]} campanha?` : ''}
        actions={
          <>
            <button type="button" className="btn" onClick={() => setConfirm(null)}>
              Voltar
            </button>
            <button
              type="button"
              className={`btn ${confirm === 'cancelled' ? 'btn-error' : 'btn-primary'}`}
              onClick={() => {
                if (confirm) transition.mutate(confirm);
                setConfirm(null);
              }}
            >
              Confirmar
            </button>
          </>
        }
      >
        <p className="text-sm">
          {confirm === 'active'
            ? 'Ao ativar, a primeira abordagem é agendada para os contatos selecionados que estiverem elegíveis (WhatsApp validado, sem recusa, sem conflito com outra campanha). Os envios respeitam a janela de horário e os limites do seu número.'
            : confirm === 'paused'
              ? 'Nenhum novo envio desta campanha sai enquanto estiver pausada. As demais campanhas continuam.'
              : confirm === 'completed'
                ? 'Envios automáticos pendentes serão cancelados. Conversas em andamento continuam com você.'
                : confirm === 'cancelled'
                  ? 'Envios automáticos pendentes serão cancelados e a campanha não poderá ser reativada. O histórico é preservado.'
                  : ''}
        </p>
      </Modal>
    </>
  );
}

type SetFn = <K extends keyof Config>(k: K, v: Config[K]) => void;

function MessagesTab({ campaign, cfg, set, disabled }: { campaign: Campaign; cfg: Config; set: SetFn; disabled: boolean }) {
  const offers = useQuery({ queryKey: ['offers'], queryFn: () => api.get<Offer[]>('/offers') });
  const list = (offers.data ?? []).filter((o) => o.service === campaign.service);
  return (
    <fieldset disabled={disabled} className="flex flex-col gap-8">
      <Field label="Oferta da campanha" hint="A oferta é copiada para cada contato no momento do agendamento; editar depois não altera o que já foi apresentado.">
        {(fid) => (
          <select id={fid} className="select w-full max-w-xl" value={cfg.offerId ?? ''} onChange={(e) => set('offerId', e.target.value ? Number(e.target.value) : null)}>
            <option value="">Selecione</option>
            {list.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} — {offerPrice(o)}
              </option>
            ))}
          </select>
        )}
      </Field>
      <TemplateEditor
        id="tpl-first"
        label="Primeira abordagem"
        campaignId={campaign.id}
        value={cfg.firstMessageTemplate ?? ''}
        onChange={(v) => set('firstMessageTemplate', v)}
        hint="Identifique-se, explique a origem do contato (Google Maps), o motivo, pergunte se pode continuar e ofereça recusa simples. Não invente relação prévia nem prometa resultados."
      />
      <TemplateEditor id="tpl-pres" label="Apresentação (após resposta afirmativa)" campaignId={campaign.id} value={cfg.presentationTemplate ?? ''} onChange={(v) => set('presentationTemplate', v)} rows={5} />
      <TemplateEditor id="tpl-done" label="Mensagem ao concluir a qualificação" campaignId={campaign.id} value={cfg.qualificationDoneTemplate ?? ''} onChange={(v) => set('qualificationDoneTemplate', v)} rows={3} />
      <TemplateEditor id="tpl-decline" label="Confirmação após recusa (opcional)" campaignId={campaign.id} value={cfg.declineAckTemplate ?? ''} onChange={(v) => set('declineAckTemplate', v)} rows={2} hint="Deixe vazio para não responder após uma recusa." />
    </fieldset>
  );
}

function QualificationTab({ cfg, set, disabled, campaignId }: { cfg: Config; set: SetFn; disabled: boolean; campaignId: number }) {
  const qs = cfg.qualificationQuestions;
  // Identificadores estáveis por item (a chave da pergunta é editável e não serve de key)
  const [ids, setIds] = useState<string[]>(() => qs.map(() => crypto.randomUUID()));
  if (ids.length !== qs.length) setIds(qs.map((_, i) => ids[i] ?? crypto.randomUUID()));
  const update = (i: number, patch: Partial<QualificationQuestion>) => set('qualificationQuestions', qs.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const move = (i: number, d: -1 | 1) => {
    const swap = <T,>(arr: T[]) => {
      const n = [...arr];
      const [it] = n.splice(i, 1);
      n.splice(i + d, 0, it!);
      return n;
    };
    setIds(swap(ids));
    set('qualificationQuestions', swap(qs));
  };
  const remove = (i: number) => {
    setIds(ids.filter((_, j) => j !== i));
    set('qualificationQuestions', qs.filter((_, j) => j !== i));
  };
  const add = () => {
    setIds([...ids, crypto.randomUUID()]);
    set('qualificationQuestions', [...qs, { key: `pergunta_${qs.length + 1}`, text: '' }]);
  };
  return (
    <fieldset disabled={disabled} className="flex flex-col gap-4">
      <p className="max-w-3xl text-sm text-base-content/70">
        Depois de uma resposta afirmativa, o aero faz estas perguntas, poucas por vez, e guarda as respostas. Dúvidas, negociação e qualquer resposta fora do roteiro passam para você. Recusas encerram a sequência a qualquer momento.
      </p>
      <Field label="Perguntas por mensagem">
        {(fid) => (
          <select id={fid} className="select w-32" value={cfg.questionsPerMessage} onChange={(e) => set('questionsPerMessage', intFromInput(e.target.value, cfg.questionsPerMessage))}>
            {[1, 2, 3].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        )}
      </Field>
      <ol className="flex flex-col gap-3">
        {qs.map((q, i) => (
          <li key={ids[i]} className="flex flex-col gap-2 rounded-box border border-base-300 bg-base-100 p-3 md:flex-row md:items-start">
            <span className="w-6 pt-2 text-sm text-base-content/60">{i + 1}.</span>
            <label className="sr-only" htmlFor={`qk-${campaignId}-${i}`}>
              Chave
            </label>
            <input id={`qk-${campaignId}-${i}`} className="input input-sm w-full font-mono md:w-40" value={q.key} pattern="[a-z0-9_]{1,40}" title="letras minúsculas, números e _" onChange={(e) => update(i, { key: e.target.value })} />
            <label className="sr-only" htmlFor={`qt-${campaignId}-${i}`}>
              Pergunta
            </label>
            <textarea id={`qt-${campaignId}-${i}`} className="textarea textarea-sm flex-1" rows={2} value={q.text} onChange={(e) => update(i, { text: e.target.value })} />
            <div className="flex gap-1">
              <button type="button" className="btn btn-ghost btn-xs" aria-label="Mover para cima" disabled={i === 0} onClick={() => move(i, -1)}>
                ↑
              </button>
              <button type="button" className="btn btn-ghost btn-xs" aria-label="Mover para baixo" disabled={i === qs.length - 1} onClick={() => move(i, 1)}>
                ↓
              </button>
              <button type="button" className="btn btn-ghost btn-xs text-error" onClick={() => remove(i)}>
                Remover
              </button>
            </div>
          </li>
        ))}
      </ol>
      <button type="button" className="btn btn-sm self-start" onClick={add} disabled={qs.length >= 20}>
        Adicionar pergunta
      </button>
    </fieldset>
  );
}

function ScheduleTab({ cfg, set, disabled }: { cfg: Config; set: SetFn; disabled: boolean }) {
  const toggleDay = (d: number) => set('sendDays', cfg.sendDays.includes(d) ? cfg.sendDays.filter((x) => x !== d) : [...cfg.sendDays, d].sort());
  return (
    <fieldset disabled={disabled} className="grid max-w-3xl gap-4 md:grid-cols-2">
      <Field label="Fuso horário da campanha" hint="Os horários abaixo seguem este fuso, independentemente do relógio do computador.">
        {(fid) => <input id={fid} className="input w-full" value={cfg.timezone} onChange={(e) => set('timezone', e.target.value)} />}
      </Field>
      <div>
        <p className="mb-1 text-sm font-medium">Dias de envio</p>
        <div className="join">
          {DAY_LABELS.map((l, d) => (
            <button key={d} type="button" aria-pressed={cfg.sendDays.includes(d)} className={`btn join-item btn-sm ${cfg.sendDays.includes(d) ? 'btn-primary' : ''}`} onClick={() => toggleDay(d)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <Field label="Início da janela">{(fid) => <input id={fid} type="time" className="input w-full" value={cfg.sendWindowStart} onChange={(e) => set('sendWindowStart', e.target.value)} />}</Field>
      <Field label="Fim da janela">{(fid) => <input id={fid} type="time" className="input w-full" value={cfg.sendWindowEnd} onChange={(e) => set('sendWindowEnd', e.target.value)} />}</Field>
      <Field label="Primeiras abordagens por dia (desta campanha)" hint="Os limites globais do número continuam valendo e são compartilhados.">
        {(fid) => <input id={fid} type="number" min={1} max={500} className="input w-full" value={cfg.dailyLimit} onChange={(e) => set('dailyLimit', intFromInput(e.target.value, cfg.dailyLimit))} />}
      </Field>
      <Field label="Encerrar sem resposta após (horas)" hint="Sem follow-up automático: após o prazo a participação é encerrada e o histórico mantido.">
        {(fid) => <input id={fid} type="number" min={1} max={1440} className="input w-full" value={cfg.noReplyCloseHours} onChange={(e) => set('noReplyCloseHours', intFromInput(e.target.value, cfg.noReplyCloseHours))} />}
      </Field>
      <p className="text-xs text-base-content/60 md:col-span-2">Após uma interrupção (computador desligado), os envios são retomados dentro da janela e dos limites — o atraso não é enviado de uma vez.</p>
    </fieldset>
  );
}

interface Eligibility {
  total: number;
  summary: Record<string, number>;
  items: { id: number; companyName: string; e164: string | null; reasons: { code: string; label: string }[] }[];
}

function AudienceTab({ campaign }: { campaign: Campaign }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState<ParticipationStatus | ''>('');
  const [page, setPage] = useState(1);
  const [review, setReview] = useState(false);
  const q = useQuery({
    queryKey: ['campaigns', 'contacts', campaign.id, status, page],
    queryFn: () => api.get<Paged<CampaignContact>>(`/campaigns/${campaign.id}/contacts`, { status: status || undefined, page, pageSize: 50 }),
    placeholderData: keepPreviousData,
  });
  const elig = useQuery({ queryKey: ['campaigns', 'eligibility', campaign.id], queryFn: () => api.get<Eligibility>(`/campaigns/${campaign.id}/eligibility`), enabled: review });
  const remove = useMutation({
    mutationFn: (id: number) => api.post(`/campaigns/${campaign.id}/contacts/remove`, { ids: [id] }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['campaigns'] }),
    onError: (e) => toast('error', errorMessage(e)),
  });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="aud-status">
          Filtrar por estado
        </label>
        <select id="aud-status" className="select select-sm w-auto" value={status} onChange={(e) => { setStatus(e.target.value as ParticipationStatus | ''); setPage(1); }}>
          <option value="">Todos os estados</option>
          {PARTICIPATION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {PARTICIPATION_STATUS_LABELS[s]} ({campaign.counts[s] ?? 0})
            </option>
          ))}
        </select>
        <Link to="/leads" className="btn btn-sm">
          Adicionar contatos pela base
        </Link>
        <button type="button" className="btn btn-sm" onClick={() => setReview(true)}>
          Revisar destinatários
        </button>
      </div>
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <ErrorAlert error={q.error} />
      ) : (
        <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Empresa</th>
                <th>Telefone</th>
                <th>WhatsApp</th>
                <th>Estado</th>
                <th>Abordado</th>
                <th>
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.companyName}
                    <p className="text-xs text-base-content/60">{r.city}</p>
                  </td>
                  <td className="tabular-nums">{r.e164}</td>
                  <td>
                    <WaBadge status={r.waStatus} />
                  </td>
                  <td>
                    <ParticipationBadge status={r.status} />
                    {r.statusReason ? <p className="max-w-56 text-xs text-base-content/60">{r.statusReason}</p> : null}
                  </td>
                  <td className="text-xs">{fmtDateTime(r.firstSentAt)}</td>
                  <td>
                    {['selected', 'blocked', 'scheduled'].includes(r.status) ? (
                      <button type="button" className="btn btn-ghost btn-xs" onClick={() => remove.mutate(r.id)}>
                        Remover
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {q.data ? <Pagination page={page} pageSize={q.data.pageSize} total={q.data.total} onChange={setPage} /> : null}
      <Modal open={review} onClose={() => setReview(false)} title="Revisão dos destinatários selecionados" wide>
        {elig.isPending ? (
          <Loading />
        ) : elig.isError ? (
          <ErrorAlert error={elig.error} />
        ) : (
          <div className="flex flex-col gap-3 text-sm">
            <p>
              {elig.data.summary.eligible ?? 0} de {elig.data.total} contato(s) selecionado(s) estão elegíveis agora. Nada é enviado por esta revisão.
            </p>
            <ul className="flex flex-wrap gap-2">
              {Object.entries(elig.data.summary)
                .filter(([k]) => k !== 'eligible')
                .map(([k, v]) => (
                  <li key={k} className="badge badge-soft badge-warning">
                    {elig.data.items.find((i) => i.reasons.some((r) => r.code === k))?.reasons.find((r) => r.code === k)?.label ?? k}: {v}
                  </li>
                ))}
            </ul>
            <ul className="max-h-80 divide-y divide-base-300 overflow-y-auto">
              {elig.data.items.map((i) => (
                <li key={i.id} className="flex justify-between gap-3 py-1">
                  <span>
                    {i.companyName} <span className="text-base-content/60">{i.e164}</span>
                  </span>
                  <span className="text-right text-xs">{i.reasons.length ? i.reasons.map((r) => r.label).join('; ') : <span className="text-success">Elegível</span>}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Modal>
    </div>
  );
}

interface Pending {
  items: { id: number; body: string | null; scheduledFor: string | null; error: string | null; purpose: string | null; conversationId: number; companyName: string }[];
  divergent: { messageId: number; current: string; updated: string; companyName: string }[];
}

function PendingTab({ campaignId }: { campaignId: number }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['campaigns', 'pending', campaignId], queryFn: () => api.get<Pending>(`/campaigns/${campaignId}/pending`) });
  const [editing, setEditing] = useState<{ id: number; body: string } | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const refresh = () => void qc.invalidateQueries({ queryKey: ['campaigns', 'pending', campaignId] });
  const cancel = useMutation({ mutationFn: (id: number) => api.post(`/inbox/messages/${id}/cancel`), onSuccess: refresh, onError: (e) => toast('error', errorMessage(e)) });
  const edit = useMutation({
    mutationFn: (m: { id: number; body: string }) => api.patch(`/inbox/messages/${m.id}`, { body: m.body }),
    onSuccess: () => {
      setEditing(null);
      refresh();
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const apply = useMutation({
    mutationFn: () => api.post<{ updated: number }>(`/campaigns/${campaignId}/pending/apply-template`, { messageIds: [...chosen] }),
    onSuccess: (r) => {
      toast('success', `${r.updated} envio(s) atualizados com o modelo atual`);
      setChosen(new Set());
      refresh();
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorAlert error={q.error} />;
  return (
    <div className="flex flex-col gap-6">
      {q.data.divergent.length ? (
        <section className="rounded-box border border-warning bg-base-100 p-4">
          <h2 className="font-semibold">Envios agendados com texto diferente do modelo atual</h2>
          <p className="mb-3 text-sm text-base-content/70">O modelo foi alterado depois do agendamento. Nada muda sem sua escolha: selecione os envios que devem usar o novo texto.</p>
          <ul className="flex flex-col gap-3">
            {q.data.divergent.map((d) => (
              <li key={d.messageId} className="grid gap-2 md:grid-cols-[auto_1fr_1fr]">
                <input type="checkbox" className="checkbox checkbox-sm mt-1" aria-label={`Atualizar envio para ${d.companyName}`} checked={chosen.has(d.messageId)} onChange={() => setChosen((s) => { const n = new Set(s); if (n.has(d.messageId)) n.delete(d.messageId); else n.add(d.messageId); return n; })} />
                <div className="whitespace-pre-wrap rounded-box bg-base-200 p-2 text-xs">
                  <p className="mb-1 font-medium">{d.companyName} — atual</p>
                  {d.current}
                </div>
                <div className="whitespace-pre-wrap rounded-box bg-primary/10 p-2 text-xs">
                  <p className="mb-1 font-medium">Com o modelo novo</p>
                  {d.updated}
                </div>
              </li>
            ))}
          </ul>
          <button type="button" className="btn btn-primary btn-sm mt-3" disabled={!chosen.size || apply.isPending} onClick={() => apply.mutate()}>
            Aplicar modelo novo aos selecionados
          </button>
        </section>
      ) : null}
      {q.data.items.length === 0 ? (
        <p className="text-sm text-base-content/70">Nenhum envio agendado.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {q.data.items.map((m) => (
            <li key={m.id} className="rounded-box border border-base-300 bg-base-100 p-3 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <p className="font-medium">
                  {m.companyName} <span className="text-xs font-normal text-base-content/60">({m.purpose === 'first_contact' ? 'primeira abordagem' : m.purpose})</span>
                </p>
                <div className="flex gap-1">
                  <button type="button" className="btn btn-ghost btn-xs" onClick={() => setEditing({ id: m.id, body: m.body ?? '' })}>
                    Editar
                  </button>
                  <button type="button" className="btn btn-ghost btn-xs text-error" onClick={() => cancel.mutate(m.id)}>
                    Cancelar envio
                  </button>
                </div>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-base-content/80">{m.body}</p>
              {m.error ? <p className="mt-1 text-xs text-warning">{m.error}</p> : null}
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="Editar envio agendado"
        actions={
          <>
            <button type="button" className="btn" onClick={() => setEditing(null)}>
              Cancelar
            </button>
            <button type="button" className="btn btn-primary" disabled={!editing?.body.trim() || edit.isPending} onClick={() => editing && edit.mutate(editing)}>
              Salvar
            </button>
          </>
        }
      >
        <label htmlFor="edit-pending" className="sr-only">
          Texto
        </label>
        <textarea id="edit-pending" className="textarea w-full" rows={8} value={editing?.body ?? ''} onChange={(e) => setEditing((x) => (x ? { ...x, body: e.target.value } : x))} />
      </Modal>
    </div>
  );
}

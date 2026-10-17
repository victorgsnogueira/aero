import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CURRENCIES, OPPORTUNITY_STAGES, OPPORTUNITY_STAGE_LABELS, SERVICE_LABELS, type OpportunityStage, type ProposalStatus } from '@aero/shared';
import { api, errorMessage } from '../lib/api';
import type { Opportunity, Proposal } from '../lib/types';
import { Field, Modal, PageHeader, QueryState } from '../components/ui';
import { MoneyInput } from '../components/MoneyInput';
import { PaymentBadge, ProposalBadge, StageBadge } from '../components/status';
import { useToast } from '../components/toast';
import { fmtDate, fmtDateTime, formatMoney } from '../lib/format';
import { offerPrice } from '../lib/offer';

interface Detail {
  opportunity: Omit<Opportunity, 'companyName' | 'city'>;
  company: { id: number; name: string; city: string | null };
  history: { id: number; fromStage: string | null; toStage: OpportunityStage; reason: string | null; actor: string; createdAt: string }[];
  proposals: Proposal[];
}

const PROPOSAL_NEXT: Record<ProposalStatus, { to: ProposalStatus; label: string }[]> = {
  draft: [
    { to: 'sent', label: 'Marcar como enviada' },
    { to: 'withdrawn', label: 'Retirar' },
  ],
  sent: [
    { to: 'accepted', label: 'Aceita' },
    { to: 'rejected', label: 'Recusada' },
    { to: 'expired', label: 'Expirou' },
    { to: 'withdrawn', label: 'Retirar' },
  ],
  accepted: [{ to: 'withdrawn', label: 'Retirar' }],
  rejected: [],
  expired: [{ to: 'sent', label: 'Reenviar' }],
  withdrawn: [],
};

export default function OpportunityDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['opportunities', 'detail', id], queryFn: () => api.get<Detail>(`/opportunities/${id}`) });
  const [stageTo, setStageTo] = useState<OpportunityStage | null>(null);
  const [reason, setReason] = useState('');
  const [newProposal, setNewProposal] = useState(false);
  const [payFor, setPayFor] = useState<Proposal | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['opportunities'] });
  const stage = useMutation({
    mutationFn: () => api.post(`/opportunities/${id}/stage`, { stage: stageTo, reason: reason.trim() || null }),
    onSuccess: () => {
      setStageTo(null);
      setReason('');
      refresh();
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const proposalStatus = useMutation({
    mutationFn: (p: { id: number; to: ProposalStatus }) => api.post(`/opportunities/proposals/${p.id}/status`, { status: p.to, reason: null }),
    onSuccess: refresh,
    onError: (e) => toast('error', errorMessage(e)),
  });
  const delPayment = useMutation({ mutationFn: (pid: number) => api.del(`/opportunities/payments/${pid}`), onSuccess: refresh, onError: (e) => toast('error', errorMessage(e)) });

  return (
    <QueryState query={q}>
      {(d) => {
        const o = d.opportunity;
        return (
          <>
            <PageHeader
              title={o.title}
              description={
                <>
                  <Link to={`/leads?q=${encodeURIComponent(d.company.name)}`} className="link">
                    {d.company.name}
                  </Link>{' '}
                  · {SERVICE_LABELS[o.service]}
                  {o.conversationId ? (
                    <>
                      {' '}
                      ·{' '}
                      <Link to={`/inbox/${o.conversationId}`} className="link">
                        conversa
                      </Link>
                    </>
                  ) : null}
                </>
              }
              actions={<StageBadge stage={o.stage} />}
            />
            <section className="mb-6 flex flex-wrap items-center gap-2">
              <span className="text-sm text-base-content/70">Mover para:</span>
              {OPPORTUNITY_STAGES.filter((s) => s !== o.stage).map((s) => (
                <button key={s} type="button" className="btn btn-sm" onClick={() => setStageTo(s)}>
                  {OPPORTUNITY_STAGE_LABELS[s]}
                </button>
              ))}
            </section>
            <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold">Propostas</h2>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => setNewProposal(true)}>
                    Nova proposta
                  </button>
                </div>
                {d.proposals.length === 0 ? <p className="text-sm text-base-content/60">Nenhuma proposta registrada.</p> : null}
                {d.proposals.map((p) => (
                  <article key={p.id} className="card border border-base-300 bg-base-100">
                    <div className="card-body gap-2 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="font-semibold">{p.title}</h3>
                        <div className="flex gap-1">
                          <ProposalBadge status={p.status} />
                          {p.status === 'accepted' ? <PaymentBadge status={p.paymentStatus} /> : null}
                        </div>
                      </div>
                      <p className="text-lg font-semibold tabular-nums">
                        {formatMoney(p.amountCents, p.currency)}
                        {p.setupCents !== null ? <span className="text-sm font-normal"> + implantação {formatMoney(p.setupCents, p.currency)}</span> : null}
                        {p.monthlyCents !== null ? <span className="text-sm font-normal"> · mensalidade {formatMoney(p.monthlyCents, p.currency)}</span> : null}
                      </p>
                      {p.scope ? <p className="whitespace-pre-wrap">{p.scope}</p> : null}
                      {p.conditions ? <p className="text-base-content/70">Condições: {p.conditions}</p> : null}
                      <p className="text-xs text-base-content/60">
                        Validade {fmtDate(p.validUntil)} · enviada {fmtDateTime(p.sentAt)} · aceita {fmtDateTime(p.acceptedAt)}
                      </p>
                      {p.status === 'accepted' ? (
                        <div className="rounded-box bg-base-200 p-2">
                          <p className="text-xs">
                            Recebido: {formatMoney(p.receivedCents, p.currency)} de {formatMoney(p.amountCents + (p.setupCents ?? 0), p.currency)} (valor + implantação; mensalidades não incluídas)
                          </p>
                          <ul className="mt-1 text-xs">
                            {p.payments.map((pay) => (
                              <li key={pay.id} className="flex items-center justify-between">
                                <span>
                                  {fmtDate(pay.receivedAt)} — {formatMoney(pay.amountCents, pay.currency)} {pay.method ? `(${pay.method})` : ''} {pay.note ?? ''}
                                </span>
                                <button type="button" className="btn btn-ghost btn-xs" onClick={() => delPayment.mutate(pay.id)}>
                                  Remover
                                </button>
                              </li>
                            ))}
                          </ul>
                          <button type="button" className="btn btn-xs mt-1" onClick={() => setPayFor(p)}>
                            Registrar pagamento
                          </button>
                        </div>
                      ) : null}
                      <div className="flex flex-wrap gap-1">
                        {PROPOSAL_NEXT[p.status].map((n) => (
                          <button key={n.to} type="button" className={`btn btn-xs ${n.to === 'accepted' ? 'btn-success' : ''}`} onClick={() => proposalStatus.mutate({ id: p.id, to: n.to })}>
                            {n.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
              <aside className="flex flex-col gap-4 text-sm">
                {o.offerSnapshot ? (
                  <section className="rounded-box border border-base-300 bg-base-100 p-3">
                    <h2 className="mb-1 font-semibold">Oferta apresentada na campanha</h2>
                    <p>{o.offerSnapshot.name}</p>
                    <p>{offerPrice(o.offerSnapshot)}</p>
                    <p className="text-xs text-base-content/60">Registrada em {fmtDateTime(o.offerSnapshot.capturedAt)}</p>
                  </section>
                ) : null}
                {o.qualificationAnswers && Object.keys(o.qualificationAnswers).length ? (
                  <section className="rounded-box border border-base-300 bg-base-100 p-3">
                    <h2 className="mb-1 font-semibold">Respostas da qualificação</h2>
                    <dl>
                      {Object.entries(o.qualificationAnswers).map(([k, v]) => (
                        <div key={k} className="mb-1">
                          <dt className="text-xs font-medium">{k}</dt>
                          <dd className="whitespace-pre-wrap">{v}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                ) : null}
                <section className="rounded-box border border-base-300 bg-base-100 p-3">
                  <h2 className="mb-1 font-semibold">Histórico de etapas</h2>
                  <ol className="flex flex-col gap-1 text-xs">
                    {d.history.map((h) => (
                      <li key={h.id}>
                        {fmtDateTime(h.createdAt)} — {h.fromStage ? `${OPPORTUNITY_STAGE_LABELS[h.fromStage as OpportunityStage]} → ` : ''}
                        {OPPORTUNITY_STAGE_LABELS[h.toStage]} {h.reason ? `(${h.reason})` : ''} <span className="text-base-content/50">[{h.actor === 'owner' ? 'você' : h.actor === 'contact' ? 'contato' : 'sistema'}]</span>
                      </li>
                    ))}
                  </ol>
                </section>
              </aside>
            </div>
            <Modal
              open={stageTo !== null}
              onClose={() => setStageTo(null)}
              title={`Mover para ${stageTo ? OPPORTUNITY_STAGE_LABELS[stageTo] : ''}`}
              actions={
                <>
                  <button type="button" className="btn" onClick={() => setStageTo(null)}>
                    Cancelar
                  </button>
                  <button type="button" className="btn btn-primary" disabled={stage.isPending || (stageTo === 'lost' && !reason.trim())} onClick={() => stage.mutate()}>
                    Confirmar
                  </button>
                </>
              }
            >
              {stageTo === 'won' ? <p className="mb-2 text-sm">Exige uma proposta aceita. Pagamento continua sendo registrado separadamente.</p> : null}
              <Field label={stageTo === 'lost' ? 'Motivo da perda (obrigatório)' : 'Motivo (opcional)'}>
                {(fid) => <input id={fid} className="input w-full" value={reason} maxLength={255} onChange={(e) => setReason(e.target.value)} />}
              </Field>
            </Modal>
            {newProposal ? <ProposalForm opportunity={o} onClose={() => setNewProposal(false)} onSaved={refresh} /> : null}
            {payFor ? <PaymentForm proposal={payFor} onClose={() => setPayFor(null)} onSaved={refresh} /> : null}
          </>
        );
      }}
    </QueryState>
  );
}

function ProposalForm({ opportunity, onClose, onSaved }: { opportunity: Detail['opportunity']; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const snap = opportunity.offerSnapshot;
  const [f, setF] = useState({
    title: snap ? `Proposta — ${snap.name}` : 'Proposta',
    scope: snap?.scope ?? '',
    amountCents: snap?.priceCents ?? null,
    setupCents: snap?.setupCents ?? null,
    monthlyCents: snap?.monthlyCents ?? null,
    currency: snap?.currency ?? 'BRL',
    conditions: snap?.conditions ?? '',
    validUntil: '',
  });
  const save = useMutation({
    mutationFn: () =>
      api.post(`/opportunities/${opportunity.id}/proposals`, {
        title: f.title.trim(),
        scope: f.scope.trim() || null,
        amountCents: f.amountCents ?? 0,
        setupCents: f.setupCents,
        monthlyCents: f.monthlyCents,
        currency: f.currency,
        conditions: f.conditions.trim() || null,
        validUntil: f.validUntil || null,
        origin: snap ? 'campanha' : 'manual',
      }),
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (f.amountCents === null) return toast('error', 'Informe o valor');
    save.mutate();
  };
  return (
    <Modal open onClose={onClose} title="Nova proposta" wide>
      <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
        <p className="text-xs text-base-content/60 md:col-span-2">Os valores ficam gravados na proposta e não mudam se a campanha ou a oferta forem editadas depois.</p>
        <Field label="Título" className="md:col-span-2">{(id) => <input id={id} className="input w-full" required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
        <Field label="Escopo resumido" className="md:col-span-2">{(id) => <textarea id={id} className="textarea w-full" rows={3} value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })} />}</Field>
        <Field label="Valor">{(id) => <MoneyInput id={id} cents={f.amountCents} onChange={(v) => setF({ ...f, amountCents: v })} />}</Field>
        <Field label="Moeda">
          {(id) => (
            <select id={id} className="select w-full" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Implantação">{(id) => <MoneyInput id={id} cents={f.setupCents} onChange={(v) => setF({ ...f, setupCents: v })} />}</Field>
        <Field label="Mensalidade">{(id) => <MoneyInput id={id} cents={f.monthlyCents} onChange={(v) => setF({ ...f, monthlyCents: v })} />}</Field>
        <Field label="Condições" className="md:col-span-2">{(id) => <textarea id={id} className="textarea w-full" rows={2} value={f.conditions} onChange={(e) => setF({ ...f, conditions: e.target.value })} />}</Field>
        <Field label="Validade">{(id) => <input id={id} type="date" className="input w-full" value={f.validUntil} onChange={(e) => setF({ ...f, validUntil: e.target.value })} />}</Field>
        <div className="modal-action md:col-span-2">
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={save.isPending}>
            Salvar rascunho
          </button>
        </div>
      </form>
    </Modal>
  );
}

function PaymentForm({ proposal, onClose, onSaved }: { proposal: Proposal; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState('');
  const [note, setNote] = useState('');
  const save = useMutation({
    mutationFn: () => api.post(`/opportunities/proposals/${proposal.id}/payments`, { amountCents: amount, currency: proposal.currency, receivedAt: new Date(`${date}T12:00:00Z`).toISOString(), method: method || null, note: note || null }),
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Registrar pagamento (${proposal.currency})`}
      actions={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" disabled={!amount || save.isPending} onClick={() => save.mutate()}>
            Registrar
          </button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="Valor recebido">{(id) => <MoneyInput id={id} cents={amount} onChange={setAmount} />}</Field>
        <Field label="Data do recebimento">{(id) => <input id={id} type="date" className="input w-full" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        <Field label="Forma (opcional)">{(id) => <input id={id} className="input w-full" value={method} maxLength={64} onChange={(e) => setMethod(e.target.value)} placeholder="Pix, boleto…" />}</Field>
        <Field label="Observação (opcional)">{(id) => <input id={id} className="input w-full" value={note} maxLength={255} onChange={(e) => setNote(e.target.value)} />}</Field>
      </div>
    </Modal>
  );
}

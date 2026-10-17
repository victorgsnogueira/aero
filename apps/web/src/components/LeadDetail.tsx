import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PARTICIPATION_STATUS_LABELS, WA_STATUS_LABELS, type OpportunityStage, type ParticipationStatus, type WaStatus } from '@aero/shared';
import { api, errorMessage } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import { Badge, ErrorAlert, Field, Loading, Modal } from './ui';
import { StageBadge } from './status';
import { useToast } from './toast';

interface LeadDetailData {
  company: {
    id: number;
    name: string;
    category: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    countryCode: string | null;
    website: string | null;
    mapsUrl: string | null;
    latitude: number | null;
    longitude: number | null;
    rating: number | null;
    reviewCount: number | null;
    notes: string | null;
    isDemo: boolean;
    firstSeenAt: string;
    lastSeenAt: string;
  };
  phones: { id: number; e164: string | null; raw_value: string; format_status: string; format_note: string | null; wa_status: WaStatus; wa_checked_at: string | null; wa_error: string | null; shared_count: number; suppression_reason: string | null }[];
  scans: { id: number; name: string; is_new: number; is_surplus: number; created_at: string }[];
  participations: { id: number; status: ParticipationStatus; status_reason: string | null; campaign_id: number; campaign_name: string; first_sent_at: string | null }[];
  opportunities: { id: number; title: string; stage: OpportunityStage }[];
  conversations: { id: number; state: string }[];
}

export function LeadDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['leads', 'detail', id], queryFn: () => api.get<LeadDetailData>(`/leads/${id}`) });
  const [notes, setNotes] = useState<string | null>(null);
  const [suppressing, setSuppressing] = useState<number | null>(null);
  const [reason, setReason] = useState('bloqueio manual');
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['leads'] });
  };
  const saveNotes = useMutation({
    mutationFn: (value: string) => api.patch(`/leads/${id}`, { notes: value || null }),
    onSuccess: () => {
      toast('success', 'Anotações salvas');
      refresh();
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const validate = useMutation({
    mutationFn: (phoneId: number) => api.post('/leads/validate', { phoneIds: [phoneId] }),
    onSuccess: () => toast('info', 'Revalidação enfileirada'),
    onError: (e) => toast('error', errorMessage(e)),
  });
  const suppress = useMutation({
    mutationFn: ({ phoneId, why }: { phoneId: number; why: string }) => api.post(`/leads/phones/${phoneId}/suppress`, { reason: why, detail: null }),
    onSuccess: () => {
      toast('success', 'Contato bloqueado para abordagens');
      setSuppressing(null);
      refresh();
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const createOpp = useMutation({
    mutationFn: (service: 'landing_page' | 'micro_saas') =>
      api.post<{ id: number }>('/opportunities', { companyId: id, service, title: `${q.data?.company.name ?? 'Lead'} — ${service === 'landing_page' ? 'Landing page' : 'Sistema sob medida'}`, conversationId: null }),
    onSuccess: () => {
      toast('success', 'Oportunidade criada');
      refresh();
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  return (
    <Modal open onClose={onClose} title={q.data?.company.name ?? 'Lead'} wide>
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <ErrorAlert error={q.error} />
      ) : (
        <div className="flex flex-col gap-5 text-sm">
          {q.data.company.isDemo ? <div className="alert alert-info alert-soft">Registro de demonstração (não é dado real).</div> : null}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-base-content/60">Categoria</dt>
            <dd>{q.data.company.category ?? '—'}</dd>
            <dt className="text-base-content/60">Endereço</dt>
            <dd>{q.data.company.address ?? '—'}</dd>
            <dt className="text-base-content/60">Local</dt>
            <dd>{[q.data.company.city, q.data.company.state, q.data.company.countryCode].filter(Boolean).join(' · ') || '—'}</dd>
            <dt className="text-base-content/60">Coordenadas</dt>
            <dd>{q.data.company.latitude !== null ? `${q.data.company.latitude}, ${q.data.company.longitude}` : 'Sem coordenadas utilizáveis'}</dd>
            <dt className="text-base-content/60">Site</dt>
            <dd className="truncate">
              {q.data.company.website ? (
                <a href={q.data.company.website} target="_blank" rel="noreferrer noopener" className="link">
                  {q.data.company.website}
                </a>
              ) : (
                '—'
              )}
            </dd>
            <dt className="text-base-content/60">Google Maps</dt>
            <dd>
              {q.data.company.mapsUrl ? (
                <a href={q.data.company.mapsUrl} target="_blank" rel="noreferrer noopener" className="link">
                  Abrir ficha
                </a>
              ) : (
                '—'
              )}
            </dd>
            <dt className="text-base-content/60">Avaliação</dt>
            <dd>{q.data.company.rating !== null ? `${q.data.company.rating} (${q.data.company.reviewCount ?? 0} avaliações)` : '—'}</dd>
            <dt className="text-base-content/60">Coletado</dt>
            <dd>
              {fmtDateTime(q.data.company.firstSeenAt)} · última vez {fmtDateTime(q.data.company.lastSeenAt)}
            </dd>
          </dl>

          <section>
            <h3 className="mb-2 font-semibold">Telefones</h3>
            {q.data.phones.length === 0 ? <p className="text-base-content/60">Nenhum telefone coletado.</p> : null}
            <ul className="flex flex-col gap-2">
              {q.data.phones.map((p) => (
                <li key={p.id} className="rounded-box border border-base-300 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium tabular-nums">{p.e164 ?? p.raw_value}</span>
                    {p.format_status !== 'valid' ? <Badge tone="warning">{p.format_status === 'needs_review' ? 'Revisar formato' : 'Formato inválido'}</Badge> : null}
                    <Badge tone={p.wa_status === 'found' ? 'success' : p.wa_status === 'inconclusive' ? 'warning' : 'ghost'}>{WA_STATUS_LABELS[p.wa_status]}</Badge>
                    {Number(p.shared_count) > 1 ? <Badge tone="info">Compartilhado com {Number(p.shared_count) - 1} outra(s) empresa(s)</Badge> : null}
                    {p.suppression_reason ? <Badge tone="error">Bloqueado: {p.suppression_reason}</Badge> : null}
                  </div>
                  <p className="mt-1 text-xs text-base-content/60">
                    Original: {p.raw_value}
                    {p.format_note ? ` · ${p.format_note}` : ''}
                    {p.wa_checked_at ? ` · verificado ${fmtDateTime(p.wa_checked_at)}` : ''}
                    {p.wa_error ? ` · ${p.wa_error}` : ''}
                  </p>
                  <p className="mt-1 text-xs text-base-content/60">Existência de conta não comprova que o número pertence à empresa nem que mensagens serão entregues.</p>
                  <div className="mt-2 flex gap-2">
                    {p.format_status === 'valid' ? (
                      <button type="button" className="btn btn-xs" onClick={() => validate.mutate(p.id)} disabled={validate.isPending}>
                        Revalidar WhatsApp
                      </button>
                    ) : null}
                    {!p.suppression_reason ? (
                      <button type="button" className="btn btn-xs btn-ghost text-error" onClick={() => setSuppressing(p.id)}>
                        Bloquear abordagens
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <div>
              <h3 className="mb-2 font-semibold">Campanhas</h3>
              {q.data.participations.length === 0 ? <p className="text-base-content/60">Sem participação.</p> : null}
              <ul className="flex flex-col gap-1">
                {q.data.participations.map((p) => (
                  <li key={p.id}>
                    <Link to={`/campanhas/${p.campaign_id}`} className="link link-hover">
                      {p.campaign_name}
                    </Link>{' '}
                    — {PARTICIPATION_STATUS_LABELS[p.status]}
                    {p.status_reason ? <span className="text-xs text-base-content/60"> ({p.status_reason})</span> : null}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="mb-2 font-semibold">Oportunidades</h3>
              <ul className="flex flex-col gap-1">
                {q.data.opportunities.map((o) => (
                  <li key={o.id} className="flex items-center gap-2">
                    <Link to={`/oportunidades/${o.id}`} className="link link-hover">
                      {o.title}
                    </Link>
                    <StageBadge stage={o.stage} />
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className="btn btn-xs" onClick={() => createOpp.mutate('landing_page')} disabled={createOpp.isPending}>
                  + Oportunidade landing page
                </button>
                <button type="button" className="btn btn-xs" onClick={() => createOpp.mutate('micro_saas')} disabled={createOpp.isPending}>
                  + Oportunidade sistema
                </button>
              </div>
              {q.data.conversations.length ? (
                <Link to={`/inbox/${q.data.conversations[0]!.id}`} className="btn btn-sm mt-3">
                  Abrir conversa
                </Link>
              ) : null}
            </div>
          </section>

          <section>
            <h3 className="mb-1 font-semibold">Origem</h3>
            <p className="text-base-content/70">
              {q.data.scans.map((s) => (
                <Link key={s.id} to={`/varreduras/${s.id}`} className="link link-hover mr-3">
                  {s.name}
                  {Number(s.is_surplus) ? ' (excedente)' : ''}
                </Link>
              ))}
            </p>
          </section>

          <Field label="Anotações">
            {(fid) => (
              <>
                <textarea id={fid} className="textarea w-full" rows={3} value={notes ?? q.data.company.notes ?? ''} onChange={(e) => setNotes(e.target.value)} />
                <button type="button" className="btn btn-sm mt-2 self-start" disabled={notes === null || saveNotes.isPending} onClick={() => saveNotes.mutate(notes ?? '')}>
                  Salvar anotações
                </button>
              </>
            )}
          </Field>
        </div>
      )}
      <Modal
        open={suppressing !== null}
        onClose={() => setSuppressing(null)}
        title="Bloquear abordagens para este número?"
        actions={
          <>
            <button type="button" className="btn" onClick={() => setSuppressing(null)}>
              Cancelar
            </button>
            <button type="button" className="btn btn-error" onClick={() => suppressing && suppress.mutate({ phoneId: suppressing, why: reason })}>
              Bloquear
            </button>
          </>
        }
      >
        <p className="mb-3 text-sm">Envios pendentes serão cancelados e o número não entrará em novas campanhas, mesmo após reimportação.</p>
        <Field label="Motivo">{(fid) => <input id={fid} className="input w-full" value={reason} maxLength={64} onChange={(e) => setReason(e.target.value)} />}</Field>
      </Modal>
    </Modal>
  );
}

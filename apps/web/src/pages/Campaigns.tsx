import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SERVICES, SERVICE_LABELS, type Service } from '@aero/shared';
import { api, errorMessage } from '../lib/api';
import type { Campaign, Offer } from '../lib/types';
import { EmptyState, Field, Modal, PageHeader, QueryState } from '../components/ui';
import { CampaignStatusBadge } from '../components/status';
import { useToast } from '../components/toast';
import { fmtNum } from '../lib/format';

export default function Campaigns() {
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ['campaigns'], queryFn: ({ signal }) => api.get<Campaign[]>('/campaigns', undefined, { signal }) });
  return (
    <>
      <PageHeader
        title="Campanhas"
        actions={
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
            Nova campanha
          </button>
        }
      />
      <QueryState query={q}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState title="Nenhuma campanha" description="Crie uma campanha, escolha a oferta, revise as mensagens e adicione contatos da base de leads." />
          ) : (
            <div className="record-list">
              {list.map((c) => {
                const sent = (c.counts.awaiting_reply ?? 0) + (c.counts.replied ?? 0) + (c.counts.qualifying ?? 0) + (c.counts.qualified ?? 0) + (c.counts.handed_off ?? 0) + (c.counts.declined ?? 0) + (c.counts.closed_no_reply ?? 0);
                const audience = Object.values(c.counts).reduce((a, b) => a + (b ?? 0), 0);
                return (
                  <Link key={c.id} to={`/campanhas/${c.id}`} className="campaign-row">
                    <div className="min-w-0">
                      <h2 className="record-title">{c.name}</h2>
                      <p className="mt-1 text-sm text-base-content/70">{SERVICE_LABELS[c.service]}</p>
                      {c.isDemo ? <span className="badge badge-ghost badge-sm mt-1">Demonstração</span> : null}
                    </div>
                    <CampaignStatusBadge status={c.status} />
                    <dl className="campaign-numbers">
                        <div>
                          <dt className="text-xs text-base-content/60">Público</dt>
                          <dd className="font-semibold tabular-nums">{fmtNum(audience)}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-base-content/60">Abordados</dt>
                          <dd className="font-semibold tabular-nums">{fmtNum(sent)}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-base-content/60">Qualificados</dt>
                          <dd className="font-semibold tabular-nums">{fmtNum(c.counts.qualified ?? 0)}</dd>
                        </div>
                    </dl>
                  </Link>
                );
              })}
            </div>
          )
        }
      </QueryState>
      {creating ? <NewCampaign onClose={() => setCreating(false)} /> : null}
    </>
  );
}

function NewCampaign({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const offers = useQuery({ queryKey: ['offers'], queryFn: ({ signal }) => api.get<Offer[]>('/offers', undefined, { signal }) });
  const [name, setName] = useState('');
  const [service, setService] = useState<Service>('landing_page');
  const [offerId, setOfferId] = useState('');
  const create = useMutation({
    mutationFn: () => api.post<Campaign>('/campaigns', { name: name.trim(), service, offerId: offerId ? Number(offerId) : null }),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: ['campaigns'] });
      navigate(`/campanhas/${c.id}`);
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };
  const filtered = (offers.data ?? []).filter((o) => o.service === service);
  return (
    <Modal open onClose={onClose} title="Nova campanha">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Nome">{(id) => <input id={id} className="input w-full" required maxLength={160} value={name} onChange={(e) => setName(e.target.value)} placeholder="Landing pages — clínicas" />}</Field>
        <Field label="Serviço" hint="Define os modelos iniciais de mensagem e as perguntas de qualificação (todos editáveis).">
          {(id) => (
            <select
              id={id}
              className="select w-full"
              value={service}
              onChange={(e) => {
                setService(e.target.value as Service);
                setOfferId('');
              }}
            >
              {SERVICES.map((s) => (
                <option key={s} value={s}>
                  {SERVICE_LABELS[s]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Oferta" hint={filtered.length === 0 ? <Link to="/ofertas" className="link">Cadastre uma oferta para este serviço</Link> : undefined}>
          {(id) => (
            <select id={id} className="select w-full" value={offerId} onChange={(e) => setOfferId(e.target.value)}>
              <option value="">Definir depois</option>
              {filtered.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <div className="modal-action">
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={create.isPending}>
            Criar rascunho
          </button>
        </div>
      </form>
    </Modal>
  );
}

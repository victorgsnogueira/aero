import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CURRENCIES, PRICE_TYPES, PRICE_TYPE_LABELS, SERVICES, SERVICE_LABELS, type PriceType, type Service } from '@aero/shared';
import { api, errorMessage } from '../lib/api';
import type { Offer } from '../lib/types';
import { EmptyState, Field, Modal, PageHeader, QueryState } from '../components/ui';
import { MoneyInput } from '../components/MoneyInput';
import { useToast } from '../components/toast';
import { formatMoney } from '../lib/format';
import { offerPrice } from '../lib/offer';

type OfferForm = Omit<Offer, 'id' | 'archived'>;

const EMPTY: OfferForm = {
  service: 'landing_page',
  name: '',
  description: null,
  scope: null,
  priceType: 'fixed',
  priceCents: null,
  setupCents: null,
  monthlyCents: null,
  currency: 'BRL',
  conditions: null,
  validUntil: null,
};

export default function Offers() {
  const [editing, setEditing] = useState<{ id: number | null; form: OfferForm } | null>(null);
  const q = useQuery({ queryKey: ['offers'], queryFn: ({ signal }) => api.get<Offer[]>('/offers', undefined, { signal }) });
  return (
    <>
      <PageHeader
        title="Ofertas"
        actions={
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing({ id: null, form: EMPTY })}>
            Nova oferta
          </button>
        }
      />
      <QueryState query={q}>
        {(offers) =>
          offers.length === 0 ? (
            <EmptyState title="Nenhuma oferta cadastrada" description="Crie ao menos uma oferta para landing pages ou sistemas sob medida antes de ativar campanhas." />
          ) : (
            <div className="record-list">
              {offers.map((o) => (
                <article key={o.id} className="offer-row">
                  <div className="min-w-0">
                    <h2 className="record-title">{o.name}</h2>
                    <p className="mt-1 text-sm text-base-content/70">{SERVICE_LABELS[o.service]}</p>
                    {o.description ? <p className="mt-2 max-w-prose text-sm">{o.description}</p> : null}
                  </div>
                  <div>
                    <p className="offer-price">{offerPrice(o)}</p>
                    <p className="text-sm text-base-content/70">
                      {o.setupCents !== null ? `Implantação: ${formatMoney(o.setupCents, o.currency)}` : null}
                      {o.setupCents !== null && o.monthlyCents !== null ? ' · ' : null}
                      {o.monthlyCents !== null ? `Mensalidade: ${formatMoney(o.monthlyCents, o.currency)}` : null}
                    </p>
                  </div>
                  <div>
                    <button type="button" className="btn btn-sm" onClick={() => setEditing({ id: o.id, form: { ...o } })}>
                      Editar
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )
        }
      </QueryState>
      {editing ? <OfferEditor key={editing.id ?? 'new'} id={editing.id} initial={editing.form} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function OfferEditor({ id, initial, onClose }: { id: number | null; initial: OfferForm; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState<OfferForm>(initial);
  const set = <K extends keyof OfferForm>(k: K, v: OfferForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...f,
        name: f.name.trim(),
        description: f.description?.trim() || null,
        scope: f.scope?.trim() || null,
        conditions: f.conditions?.trim() || null,
        validUntil: f.validUntil || null,
        priceCents: f.priceType === 'custom_quote' ? null : f.priceCents,
      };
      return id ? api.put<Offer>(`/offers/${id}`, body) : api.post<Offer>('/offers', body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['offers'] });
      toast('success', 'Oferta salva');
      onClose();
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  return (
    <Modal open onClose={onClose} title={id ? 'Editar oferta' : 'Nova oferta'} wide>
      <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
        <Field label="Serviço">
          {(fid) => (
            <select id={fid} className="select w-full" value={f.service} onChange={(e) => set('service', e.target.value as Service)} disabled={id !== null}>
              {SERVICES.map((s) => (
                <option key={s} value={s}>
                  {SERVICE_LABELS[s]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Nome da oferta">{(fid) => <input id={fid} className="input w-full" required maxLength={160} value={f.name} onChange={(e) => set('name', e.target.value)} />}</Field>
        <Field label="Descrição" className="md:col-span-2">
          {(fid) => <textarea id={fid} className="textarea w-full" rows={2} value={f.description ?? ''} onChange={(e) => set('description', e.target.value)} />}
        </Field>
        <Field label="Escopo resumido" className="md:col-span-2">
          {(fid) => <textarea id={fid} className="textarea w-full" rows={3} value={f.scope ?? ''} onChange={(e) => set('scope', e.target.value)} />}
        </Field>
        <Field label="Tipo de preço">
          {(fid) => (
            <select id={fid} className="select w-full" value={f.priceType} onChange={(e) => set('priceType', e.target.value as PriceType)}>
              {PRICE_TYPES.map((p) => (
                <option key={p} value={p}>
                  {PRICE_TYPE_LABELS[p]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Moeda">
          {(fid) => (
            <select id={fid} className="select w-full" value={f.currency} onChange={(e) => set('currency', e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          )}
        </Field>
        {f.priceType !== 'custom_quote' ? (
          <Field label={f.priceType === 'starting_at' ? 'Preço a partir de' : 'Preço'}>{(fid) => <MoneyInput id={fid} cents={f.priceCents} onChange={(v) => set('priceCents', v)} />}</Field>
        ) : null}
        <Field label="Implantação (opcional)">{(fid) => <MoneyInput id={fid} cents={f.setupCents} onChange={(v) => set('setupCents', v)} />}</Field>
        <Field label="Mensalidade (opcional)">{(fid) => <MoneyInput id={fid} cents={f.monthlyCents} onChange={(v) => set('monthlyCents', v)} />}</Field>
        <Field label="Validade (opcional)">{(fid) => <input id={fid} type="date" className="input w-full" value={f.validUntil ?? ''} onChange={(e) => set('validUntil', e.target.value || null)} />}</Field>
        <Field label="Condições comerciais" className="md:col-span-2">
          {(fid) => <textarea id={fid} className="textarea w-full" rows={2} value={f.conditions ?? ''} onChange={(e) => set('conditions', e.target.value)} />}
        </Field>
        <div className="modal-action md:col-span-2">
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={save.isPending}>
            Salvar
          </button>
        </div>
      </form>
    </Modal>
  );
}

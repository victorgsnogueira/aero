import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SCAN_MODE_LABELS, SCAN_TARGET_LABELS, type ScanMode, type ScanTargetKind } from '@aero/shared';
import { api, errorMessage } from '../lib/api';
import type { Campaign, Paged, Scan, Settings } from '../lib/types';
import { EmptyState, Field, Modal, PageHeader, Pagination, QueryState } from '../components/ui';
import { ScanStatusBadge } from '../components/status';
import { useToast } from '../components/toast';
import { fmtDateTime, fmtNum } from '../lib/format';
import { intFromInput } from '../lib/numbers';

export default function Scans() {
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ['scans', page], queryFn: () => api.get<Paged<Scan>>('/scans', { page, pageSize: 20 }) });
  return (
    <>
      <PageHeader
        title="Varreduras"
        description="Coleta de estabelecimentos pelo Google Maps Scraper. Coletar ou validar nunca envia mensagens."
        actions={
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
            Nova varredura
          </button>
        }
      />
      <QueryState query={q}>
        {(data) =>
          data.items.length === 0 ? (
            <EmptyState title="Nenhuma varredura ainda" description="Defina segmento, região e a quantidade desejada para começar a coletar." />
          ) : (
            <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
              <table className="table">
                <thead>
                  <tr>
                    <th>Varredura</th>
                    <th>Região</th>
                    <th>Estado</th>
                    <th className="text-right">Meta</th>
                    <th className="text-right">Estabelecimentos</th>
                    <th className="text-right">WhatsApps</th>
                    <th>Criada</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((s) => (
                    <tr key={s.id} className="hover:bg-base-200/50">
                      <td>
                        <Link to={`/varreduras/${s.id}`} className="link link-hover font-medium">
                          {s.name}
                        </Link>
                        <p className="text-xs text-base-content/60">{SCAN_MODE_LABELS[s.mode]}</p>
                      </td>
                      <td className="max-w-56 truncate">{s.regionLabel}</td>
                      <td>
                        <ScanStatusBadge status={s.status} />
                      </td>
                      <td className="text-right tabular-nums">
                        {fmtNum(s.targetProgress)} / {fmtNum(s.targetCount)}
                        <p className="text-xs text-base-content/60">{SCAN_TARGET_LABELS[s.targetKind]}</p>
                      </td>
                      <td className="text-right tabular-nums">{fmtNum(s.placesFound)}</td>
                      <td className="text-right tabular-nums">{fmtNum(s.waConfirmed)}</td>
                      <td className="whitespace-nowrap text-sm">{fmtDateTime(s.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </QueryState>
      {q.data ? <Pagination page={page} pageSize={q.data.pageSize} total={q.data.total} onChange={setPage} /> : null}
      {creating ? <NewScan onClose={() => setCreating(false)} /> : null}
    </>
  );
}

function NewScan({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get<Settings>('/settings') });
  const campaigns = useQuery({ queryKey: ['campaigns'], queryFn: () => api.get<Campaign[]>('/campaigns') });
  const [f, setF] = useState({
    name: '',
    segment: '',
    category: '',
    keywords: '',
    neighborhood: '',
    city: '',
    state: '',
    country: 'Brasil',
    countryCode: 'BR',
    language: 'pt',
    mode: 'collect_only' as ScanMode,
    targetKind: 'unique_phones' as ScanTargetKind,
    targetCount: 50,
    campaignId: '',
    maxUnits: 10,
    maxDurationMinutes: 120,
    startNow: true,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const create = useMutation({
    mutationFn: () =>
      api.post<Scan>('/scans', {
        name: f.name.trim(),
        segment: f.segment.trim() || null,
        category: f.category.trim() || null,
        keywords: f.keywords
          .split(/\n|,/)
          .map((k) => k.trim())
          .filter(Boolean),
        neighborhood: f.neighborhood.trim() || null,
        city: f.city.trim() || null,
        state: f.state.trim() || null,
        country: f.country.trim() || null,
        countryCode: f.countryCode.trim().toUpperCase() || null,
        language: f.language,
        mode: f.mode,
        targetKind: f.mode === 'collect_only' ? 'unique_phones' : f.targetKind,
        targetCount: f.targetCount,
        campaignId: f.campaignId ? Number(f.campaignId) : null,
        maxUnits: f.maxUnits,
        maxDurationMinutes: f.maxDurationMinutes,
        startNow: f.startNow,
      }),
    onSuccess: (scan) => {
      void qc.invalidateQueries({ queryKey: ['scans'] });
      toast('success', f.startNow ? 'Varredura iniciada' : 'Varredura criada');
      navigate(`/varreduras/${scan.id}`);
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };
  return (
    <Modal open onClose={onClose} title="Nova varredura" wide>
      <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
        <Field label="Nome" className="md:col-span-2">
          {(id) => <input id={id} className="input w-full" required maxLength={160} value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Clínicas odontológicas — Pinheiros" />}
        </Field>
        <Field label="Segmento">{(id) => <input id={id} className="input w-full" value={f.segment} onChange={(e) => set('segment', e.target.value)} placeholder="Saúde" />}</Field>
        <Field label="Categoria">{(id) => <input id={id} className="input w-full" value={f.category} onChange={(e) => set('category', e.target.value)} placeholder="Dentista" />}</Field>
        <Field label="Termos de busca" className="md:col-span-2" hint="Um por linha (ou separados por vírgula). Cada termo vira uma consulta ao Google Maps com a região abaixo.">
          {(id) => <textarea id={id} className="textarea w-full" rows={3} required value={f.keywords} onChange={(e) => set('keywords', e.target.value)} placeholder={'dentista\nclínica odontológica'} />}
        </Field>
        <fieldset className="grid gap-4 md:col-span-2 md:grid-cols-4">
          <legend className="mb-2 text-sm font-medium">Região (orienta a busca; os resultados podem incluir locais próximos)</legend>
          <Field label="Bairro">{(id) => <input id={id} className="input w-full" value={f.neighborhood} onChange={(e) => set('neighborhood', e.target.value)} />}</Field>
          <Field label="Cidade">{(id) => <input id={id} className="input w-full" value={f.city} onChange={(e) => set('city', e.target.value)} />}</Field>
          <Field label="Estado">{(id) => <input id={id} className="input w-full" value={f.state} onChange={(e) => set('state', e.target.value)} />}</Field>
          <Field label="País">{(id) => <input id={id} className="input w-full" value={f.country} onChange={(e) => set('country', e.target.value)} />}</Field>
        </fieldset>
        <Field label="Código do país (2 letras)" hint="Usado para normalizar telefones sem DDI.">
          {(id) => <input id={id} className="input w-full uppercase" maxLength={2} value={f.countryCode} onChange={(e) => set('countryCode', e.target.value.toUpperCase())} />}
        </Field>
        <Field label="Idioma da busca" hint="Código de 2 letras aceito pelo coletor (pt, en, es…).">
          {(id) => <input id={id} className="input w-full lowercase" maxLength={2} pattern="[a-z]{2}" value={f.language} onChange={(e) => set('language', e.target.value.toLowerCase())} />}
        </Field>
        <Field label="Modo">
          {(id) => (
            <select id={id} className="select w-full" value={f.mode} onChange={(e) => set('mode', e.target.value as ScanMode)}>
              <option value="collect_only">{SCAN_MODE_LABELS.collect_only}</option>
              <option value="collect_and_validate">{SCAN_MODE_LABELS.collect_and_validate}</option>
            </select>
          )}
        </Field>
        <Field label="Meta" hint={f.mode === 'collect_only' ? 'No modo "somente coletar" a meta é de números únicos.' : 'WhatsApps confirmados podem exigir analisar mais estabelecimentos.'}>
          {(id) => (
            <select id={id} className="select w-full" value={f.mode === 'collect_only' ? 'unique_phones' : f.targetKind} disabled={f.mode === 'collect_only'} onChange={(e) => set('targetKind', e.target.value as ScanTargetKind)}>
              <option value="unique_phones">{SCAN_TARGET_LABELS.unique_phones}</option>
              <option value="whatsapp_confirmed">{SCAN_TARGET_LABELS.whatsapp_confirmed}</option>
            </select>
          )}
        </Field>
        <Field label="Quantidade desejada (X)">{(id) => <input id={id} type="number" min={1} max={5000} className="input w-full" value={f.targetCount} onChange={(e) => set('targetCount', intFromInput(e.target.value, f.targetCount))} />}</Field>
        <Field label="Vincular a campanha (opcional)" hint="Apenas organiza; não adiciona nem envia nada automaticamente.">
          {(id) => (
            <select id={id} className="select w-full" value={f.campaignId} onChange={(e) => set('campaignId', e.target.value)}>
              <option value="">Nenhuma</option>
              {(campaigns.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Máximo de consultas" hint="Limite de esforço: inclui a segunda passada com mais profundidade.">
          {(id) => <input id={id} type="number" min={1} max={200} className="input w-full" value={f.maxUnits} onChange={(e) => set('maxUnits', intFromInput(e.target.value, f.maxUnits))} />}
        </Field>
        <Field label="Tempo máximo total (min)">{(id) => <input id={id} type="number" min={5} max={1440} className="input w-full" value={f.maxDurationMinutes} onChange={(e) => set('maxDurationMinutes', intFromInput(e.target.value, f.maxDurationMinutes))} />}</Field>
        <p className="text-xs text-base-content/60 md:col-span-2">
          Profundidade padrão: {settings.data?.scanDefaultDepth ?? '—'} · tempo por consulta: {settings.data?.scanUnitMaxSeconds ?? '—'} s (ajustáveis em Configurações). Se a meta não for atingida dentro dos limites, a varredura termina como parcial, com o motivo.
        </p>
        <label className="flex items-center gap-2 md:col-span-2">
          <input type="checkbox" className="checkbox checkbox-sm" checked={f.startNow} onChange={(e) => set('startNow', e.target.checked)} />
          <span className="text-sm">Iniciar imediatamente</span>
        </label>
        <div className="modal-action md:col-span-2">
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={create.isPending}>
            {f.startNow ? 'Criar e iniciar' : 'Criar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

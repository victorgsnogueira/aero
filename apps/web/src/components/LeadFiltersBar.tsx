import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { WA_STATUSES, WA_STATUS_LABELS } from '@aero/shared';
import { api } from '../lib/api';
import type { Campaign, LeadFilters, Paged, Scan } from '../lib/types';

export function LeadFiltersBar({ filters, onChange, compact = false }: { filters: LeadFilters; onChange: (p: Partial<LeadFilters>) => void; compact?: boolean }) {
  const [q, setQ] = useState(filters.q ?? '');
  // Sincroniza com mudanças externas da URL (estado derivado durante o render)
  const [prevQ, setPrevQ] = useState(filters.q);
  if (filters.q !== prevQ) {
    setPrevQ(filters.q);
    setQ(filters.q ?? '');
  }
  // Busca textual com pequeno atraso para não consultar a cada tecla
  useEffect(() => {
    const t = setTimeout(() => {
      if ((filters.q ?? '') !== q) onChange({ q: q || undefined });
    }, 350);
    return () => clearTimeout(t);
  }, [q, filters.q, onChange]);
  const facets = useQuery({ queryKey: ['leads', 'facets'], queryFn: () => api.get<{ categories: string[]; cities: string[] }>('/leads/facets'), staleTime: 60_000 });
  const scans = useQuery({ queryKey: ['scans', 'all'], queryFn: () => api.get<Paged<Scan>>('/scans', { pageSize: 200 }), staleTime: 60_000 });
  const campaigns = useQuery({ queryKey: ['campaigns'], queryFn: () => api.get<Campaign[]>('/campaigns'), staleTime: 60_000 });
  const sel = 'select select-sm w-full';
  return (
    <div className={`grid gap-2 ${compact ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-2 md:grid-cols-3 xl:grid-cols-6'}`}>
      <label className="input input-sm col-span-2 w-full md:col-span-1">
        <span className="sr-only">Buscar</span>
        <input type="search" placeholder="Buscar nome, endereço ou telefone" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <select aria-label="Varredura" className={sel} value={filters.scanId ?? ''} onChange={(e) => onChange({ scanId: e.target.value ? Number(e.target.value) : undefined })}>
        <option value="">Todas as varreduras</option>
        {(scans.data?.items ?? []).map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <select aria-label="Campanha" className={sel} value={filters.campaignId ?? ''} onChange={(e) => onChange({ campaignId: e.target.value ? Number(e.target.value) : undefined })}>
        <option value="">Todas as campanhas</option>
        {(campaigns.data ?? []).map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <select aria-label="Segmento/categoria" className={sel} value={filters.category ?? ''} onChange={(e) => onChange({ category: e.target.value || undefined })}>
        <option value="">Todas as categorias</option>
        {(facets.data?.categories ?? []).map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
      <select aria-label="Cidade" className={sel} value={filters.city ?? ''} onChange={(e) => onChange({ city: e.target.value || undefined })}>
        <option value="">Todas as cidades</option>
        {(facets.data?.cities ?? []).map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
      <select aria-label="Validação de WhatsApp" className={sel} value={filters.waStatus ?? ''} onChange={(e) => onChange({ waStatus: (e.target.value || undefined) as LeadFilters['waStatus'] })}>
        <option value="">Qualquer validação</option>
        {WA_STATUSES.map((s) => (
          <option key={s} value={s}>
            {WA_STATUS_LABELS[s]}
          </option>
        ))}
      </select>
    </div>
  );
}

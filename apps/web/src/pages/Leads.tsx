import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, keepPreviousData } from '@tanstack/react-query';
import { api, errorMessage } from '../lib/api';
import type { Campaign, LeadRow, Paged } from '../lib/types';
import { useLeadFilters } from '../lib/useLeadFilters';
import { LeadFiltersBar } from '../components/LeadFiltersBar';
import { LeadDetail } from '../components/LeadDetail';
import { Badge, EmptyState, ErrorAlert, Loading, Modal, PageHeader, Pagination } from '../components/ui';
import { StageBadge, WaBadge } from '../components/status';
import { useToast } from '../components/toast';
import { fmtDate } from '../lib/format';

export default function Leads() {
  const [filters, setFilters] = useLeadFilters();
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [detail, setDetail] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const q = useQuery({
    queryKey: ['leads', 'list', filters, page],
    queryFn: () => api.get<Paged<LeadRow>>('/leads', { ...filters, page, pageSize: 50 }),
    placeholderData: keepPreviousData,
  });
  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const onFilter = (p: Parameters<typeof setFilters>[0]) => {
    setPage(1);
    setFilters(p);
  };

  return (
    <>
      <PageHeader
        title="Base de leads"
        description="Empresas coletadas, telefones normalizados e estado de validação. A paginação e os filtros são aplicados no servidor."
        actions={
          <>
            <Link to={`/mapa${location.search}`} className="btn btn-sm">
              Ver no mapa
            </Link>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setAdding(true)} disabled={selected.size === 0 && !q.data?.total}>
              {selected.size ? `Adicionar ${selected.size} à campanha` : 'Adicionar filtrados à campanha'}
            </button>
          </>
        }
      />
      <LeadFiltersBar filters={filters} onChange={onFilter} />
      <div className="mt-2 flex flex-wrap gap-3 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" className="checkbox checkbox-xs" checked={filters.hasCoords === false} onChange={(e) => onFilter({ hasCoords: e.target.checked ? false : undefined })} />
          Somente sem coordenadas
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" className="checkbox checkbox-xs" checked={filters.suppressed === true} onChange={(e) => onFilter({ suppressed: e.target.checked ? true : undefined })} />
          Somente bloqueados
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" className="checkbox checkbox-xs" checked={filters.includeDemo === true} onChange={(e) => onFilter({ includeDemo: e.target.checked ? true : undefined })} />
          Incluir dados de demonstração
        </label>
      </div>
      <div className="mt-4">
        {q.isPending ? (
          <Loading />
        ) : q.isError ? (
          <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />
        ) : q.data.items.length === 0 ? (
          <EmptyState title="Nenhum lead encontrado" description="Ajuste os filtros ou faça uma varredura." action={<Link to="/varreduras" className="btn btn-sm">Ir para varreduras</Link>} />
        ) : (
          <div className={`overflow-x-auto rounded-box border border-base-300 bg-base-100 ${q.isFetching ? 'opacity-70' : ''}`}>
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>
                    <span className="sr-only">Selecionar</span>
                  </th>
                  <th>Empresa</th>
                  <th>Telefone</th>
                  <th>WhatsApp</th>
                  <th>Local</th>
                  <th>Situação</th>
                  <th>Visto em</th>
                </tr>
              </thead>
              <tbody>
                {q.data.items.map((l) => (
                  <tr key={l.id} className="hover:bg-base-200/50">
                    <td>
                      <input type="checkbox" className="checkbox checkbox-sm" aria-label={`Selecionar ${l.name}`} checked={selected.has(l.id)} onChange={() => toggle(l.id)} />
                    </td>
                    <td className="max-w-64">
                      <button type="button" className="link link-hover text-left font-medium" onClick={() => setDetail(l.id)}>
                        {l.name}
                      </button>
                      <p className="truncate text-xs text-base-content/60">{l.category ?? '—'}</p>
                    </td>
                    <td className="whitespace-nowrap tabular-nums">
                      {l.phoneE164 ?? l.phoneRaw ?? '—'}
                      {l.phoneCount > 1 ? <span className="ml-1 text-xs text-base-content/60">+{l.phoneCount - 1}</span> : null}
                      {l.formatStatus && l.formatStatus !== 'valid' ? (
                        <div>
                          <Badge tone="warning">{l.formatStatus === 'needs_review' ? 'Revisar' : 'Inválido'}</Badge>
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <WaBadge status={l.waStatus} />
                    </td>
                    <td className="text-sm">
                      {[l.city, l.state].filter(Boolean).join(' · ') || '—'}
                      {!l.hasCoords ? <p className="text-xs text-warning">Sem coordenadas</p> : null}
                    </td>
                    <td className="flex flex-wrap gap-1">
                      {l.suppressed ? <Badge tone="error">Bloqueado</Badge> : null}
                      {l.sharedPhone ? <Badge tone="info">Telefone compartilhado</Badge> : null}
                      {l.activeParticipations ? <Badge tone="primary">Em campanha</Badge> : null}
                      {l.opportunityStage ? <StageBadge stage={l.opportunityStage} /> : null}
                      {l.isDemo ? <Badge>Demonstração</Badge> : null}
                    </td>
                    <td className="whitespace-nowrap text-xs">{fmtDate(l.lastSeenAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {q.data ? <Pagination page={page} pageSize={q.data.pageSize} total={q.data.total} onChange={setPage} /> : null}
      </div>
      {detail !== null ? <LeadDetail id={detail} onClose={() => setDetail(null)} /> : null}
      {adding ? <AddToCampaign ids={[...selected]} filters={selected.size ? null : filters} total={q.data?.total ?? 0} onClose={() => setAdding(false)} onDone={() => setSelected(new Set())} /> : null}
    </>
  );
}

function AddToCampaign({ ids, filters, total, onClose, onDone }: { ids: number[]; filters: object | null; total: number; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const campaigns = useQuery({ queryKey: ['campaigns'], queryFn: () => api.get<Campaign[]>('/campaigns') });
  const [campaignId, setCampaignId] = useState<string>('');
  const add = useMutation({
    mutationFn: () => api.post<{ added: number; skipped: number }>(`/campaigns/${campaignId}/contacts`, filters ? { filters } : { companyIds: ids }),
    onSuccess: (r) => {
      toast('success', `${r.added} contato(s) adicionados; ${r.skipped} ignorado(s) (já presentes, sem telefone válido ou repetidos)`);
      onDone();
      onClose();
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const open = (campaigns.data ?? []).filter((c) => c.status !== 'completed' && c.status !== 'cancelled');
  return (
    <Modal
      open
      onClose={onClose}
      title="Adicionar ao público da campanha"
      actions={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" disabled={!campaignId || add.isPending} onClick={() => add.mutate()}>
            Adicionar
          </button>
        </>
      }
    >
      <p className="mb-3 text-sm">
        {filters ? `Todos os ${total} leads do filtro atual (exceto bloqueados).` : `${ids.length} empresa(s) selecionada(s).`} Adicionar não envia mensagens; o envio só ocorre ao ativar a campanha, para contatos elegíveis.
      </p>
      <label className="sr-only" htmlFor="add-campaign">
        Campanha
      </label>
      <select id="add-campaign" className="select w-full" value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
        <option value="">Selecione a campanha</option>
        {open.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </Modal>
  );
}

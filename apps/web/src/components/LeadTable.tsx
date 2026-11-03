import type { LeadSortField, SortDirection } from '@aero/shared';
import type { LeadRow } from '../lib/types';
import { fmtDate } from '../lib/format';
import { Badge } from './ui';
import { StageBadge, WaBadge } from './status';
import { Icon } from './Icon';

const COLUMNS: { field: LeadSortField; label: string; width: string; numeric?: boolean }[] = [
  { field: 'name', label: 'Empresa', width: '22%' },
  { field: 'category', label: 'Categoria', width: '11%' },
  { field: 'phone', label: 'Telefone', width: '10%', numeric: true },
  { field: 'whatsapp', label: 'WhatsApp', width: '10%' },
  { field: 'local', label: 'Local', width: '16%' },
  { field: 'situation', label: 'Situação', width: '16%' },
  { field: 'recent', label: 'Visto em', width: '11.5%', numeric: true },
];

export function LeadTable({
  items,
  selected,
  sort,
  direction,
  busy = false,
  onToggle,
  onSelectPage,
  onSort,
  onOpen,
}: {
  items: LeadRow[];
  selected: Set<number>;
  sort: LeadSortField;
  direction: SortDirection;
  busy?: boolean;
  onToggle: (id: number) => void;
  onSelectPage: (checked: boolean) => void;
  onSort: (field: LeadSortField) => void;
  onOpen: (id: number) => void;
}) {
  const count = items.filter((item) => selected.has(item.id)).length;
  const all = items.length > 0 && count === items.length;
  const partial = count > 0 && !all;
  return (
    <div className={`data-table ${busy ? 'opacity-70' : ''}`} aria-busy={busy}>
      <table className="table table-sm lead-table">
        <colgroup>
          <col style={{ width: '3.5%' }} />
          {COLUMNS.map((column) => <col key={column.field} style={{ width: column.width }} />)}
        </colgroup>
        <thead>
          <tr>
            <th scope="col">
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                aria-label={all ? 'Desmarcar todos desta página' : 'Selecionar todos desta página'}
                aria-checked={partial ? 'mixed' : all}
                ref={(element) => {
                  if (element) element.indeterminate = partial;
                }}
                checked={all}
                disabled={busy || items.length === 0}
                onChange={(event) => onSelectPage(event.target.checked)}
              />
            </th>
            {COLUMNS.map((column) => {
              const active = sort === column.field;
              return (
                <th
                  key={column.field}
                  scope="col"
                  className={column.numeric ? 'text-right' : undefined}
                  aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  <button
                    type="button"
                    className={`table-sort ${active ? 'is-sorted' : ''}`}
                    onClick={() => onSort(column.field)}
                    title={`Ordenar por ${column.label.toLowerCase()} em ordem ${active && direction === 'asc' ? 'decrescente' : 'crescente'}`}
                  >
                    {column.label}
                    <Icon name={active ? (direction === 'asc' ? 'sortAsc' : 'sortDesc') : 'sort'} />
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {items.map((l) => (
            <tr key={l.id} className="hover:bg-base-200/50" aria-selected={selected.has(l.id)}>
              <td>
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm"
                  aria-label={`Selecionar ${l.name}`}
                  disabled={busy}
                  checked={selected.has(l.id)}
                  onChange={() => onToggle(l.id)}
                />
              </td>
              <td>
                <button type="button" className="link link-hover text-left font-medium" title={l.name} onClick={() => onOpen(l.id)}>
                  {l.name}
                </button>
              </td>
              <td className="truncate text-base-content/70" title={l.category ?? undefined}>
                {l.category ?? '—'}
              </td>
              <td className="whitespace-nowrap text-right tabular-nums">
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
              <td>
                <div className="flex flex-wrap gap-1">
                  {l.suppressed ? <Badge tone="error">Bloqueado</Badge> : null}
                  {l.sharedPhone ? <Badge tone="info">Telefone compartilhado</Badge> : null}
                  {l.activeParticipations ? <Badge tone="primary">Em campanha</Badge> : null}
                  {l.opportunityStage ? <StageBadge stage={l.opportunityStage} /> : null}
                  {l.isDemo ? <Badge>Demonstração</Badge> : null}
                </div>
              </td>
              <td className="whitespace-nowrap text-right text-xs">{fmtDate(l.lastSeenAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

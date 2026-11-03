import type { MapResponse } from '../lib/types';
import { Icon } from './Icon';
import { StageBadge, WaBadge } from './status';
import { EmptyState, Loading } from './ui';

type MapLead = MapResponse['points'][number];

export function MapLeadList({ data, selected, loading, onLocate, onOpen }: {
  data: MapResponse | null;
  selected: number | null;
  loading: boolean;
  onLocate: (lead: MapLead) => void;
  onOpen: (id: number) => void;
}) {
  const points = data?.points ?? [];
  if (!data && loading) return <Loading label="Buscando leads…" />;
  if (!data) return null;
  if (!points.length) {
    return data.mode === 'grid'
      ? <EmptyState title="Aproxime o mapa" description="Os leads desta área estão agrupados. Aproxime para ver cada um." />
      : <EmptyState title="Nenhum lead nesta área" description="Mova o mapa ou ajuste os filtros para encontrar leads." />;
  }
  return (
    <ul className="map-lead-list" aria-label="Leads no mapa" aria-busy={loading}>
      {points.slice(0, 300).map((lead) => (
        <li key={lead.id} className={`map-lead-row ${selected === lead.id ? 'is-selected' : ''}`}>
          <button
            type="button"
            className="map-lead-locate"
            aria-label={`Localizar ${lead.name} no mapa`}
            aria-pressed={selected === lead.id}
            onClick={() => onLocate(lead)}
          >
            <Icon name="pin" className="map-lead-pin" />
            <span className="map-lead-content">
              <span className="map-lead-name" title={lead.name}>{lead.name}</span>
              <span className="map-lead-meta">
                <WaBadge status={lead.waStatus} />
                {lead.stage ? <StageBadge stage={lead.stage} /> : null}
              </span>
            </span>
          </button>
          <button
            type="button"
            className="map-lead-open"
            aria-label={`Ver lead ${lead.name}`}
            title="Ver lead"
            onClick={() => onOpen(lead.id)}
          >
            <Icon name="chevron" />
          </button>
        </li>
      ))}
    </ul>
  );
}

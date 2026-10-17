import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { LngLatBounds, Map as MaplibreMap, NavigationControl, setWorkerUrl, type GeoJSONSource, type LngLatBoundsLike } from 'maplibre-gl';
// O MapLibre 6 deriva a URL do worker do próprio módulo, o que não funciona com o
// empacotamento do Vite. O worker é empacotado pelo Vite (resolvendo suas
// dependências) e registrado explicitamente.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

setWorkerUrl(maplibreWorkerUrl);

type MlMap = MaplibreMap;
type PointGeometry = { coordinates: [number, number] };
import { WA_STATUS_LABELS, type WaStatus } from '@aero/shared';
import { api, errorMessage } from '../lib/api';
import type { LeadFilters, MapResponse } from '../lib/types';
import { useLeadFilters } from '../lib/useLeadFilters';
import { useTheme } from '../lib/theme';
import { LeadFiltersBar } from '../components/LeadFiltersBar';
import { LeadDetail } from '../components/LeadDetail';
import { PageHeader } from '../components/ui';
import { WaBadge } from '../components/status';
import { fmtNum } from '../lib/format';

// O mapa apenas VISUALIZA coordenadas coletadas pelo Google Maps Scraper.
// Não geocodifica, não define região de coleta e não inventa posições:
// registros sem coordenadas utilizáveis ficam fora do mapa e são contados à parte.

const STYLE_LIGHT = 'https://tiles.openfreemap.org/styles/positron';
const STYLE_DARK = 'https://tiles.openfreemap.org/styles/dark';
const INITIAL: { center: [number, number]; zoom: number } = { center: [-47.9, -15.8], zoom: 3.5 };

const WA_COLORS: Record<string, string> = {
  found: '#16a34a',
  not_found: '#6b7280',
  inconclusive: '#d97706',
  invalid_format: '#dc2626',
  pending: '#2563eb',
};

function isDark(theme: string): boolean {
  if (theme === 'aero-dark') return true;
  if (theme === 'aero') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function addLayers(map: MlMap) {
  if (!map.getSource('leads')) {
    map.addSource('leads', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, cluster: true, clusterRadius: 48, clusterMaxZoom: 15 });
  }
  if (!map.getSource('cells')) map.addSource('cells', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  const brand = '#1d4ed8';
  if (!map.getLayer('clusters'))
    map.addLayer({
      id: 'clusters',
      type: 'circle',
      source: 'leads',
      filter: ['has', 'point_count'],
      paint: { 'circle-color': brand, 'circle-opacity': 0.85, 'circle-radius': ['step', ['get', 'point_count'], 14, 20, 18, 100, 24, 500, 30], 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' },
    });
  if (!map.getLayer('cluster-count'))
    map.addLayer({
      id: 'cluster-count',
      type: 'symbol',
      source: 'leads',
      filter: ['has', 'point_count'],
      layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 12, 'text-font': ['Noto Sans Bold'] },
      paint: { 'text-color': '#ffffff' },
    });
  if (!map.getLayer('points'))
    map.addLayer({
      id: 'points',
      type: 'circle',
      source: 'leads',
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': ['match', ['get', 'waStatus'], 'found', WA_COLORS.found!, 'not_found', WA_COLORS.not_found!, 'inconclusive', WA_COLORS.inconclusive!, 'invalid_format', WA_COLORS.invalid_format!, WA_COLORS.pending!],
        'circle-radius': ['case', ['boolean', ['feature-state', 'selected'], false], 10, 7],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
      },
    });
  if (!map.getLayer('cells'))
    map.addLayer({
      id: 'cells',
      type: 'circle',
      source: 'cells',
      paint: { 'circle-color': brand, 'circle-opacity': 0.6, 'circle-radius': ['interpolate', ['linear'], ['get', 'count'], 1, 10, 100, 22, 5000, 40] },
    });
  if (!map.getLayer('cells-count'))
    map.addLayer({
      id: 'cells-count',
      type: 'symbol',
      source: 'cells',
      layout: { 'text-field': ['to-string', ['get', 'count']], 'text-size': 12, 'text-font': ['Noto Sans Bold'] },
      paint: { 'text-color': '#ffffff' },
    });
}

export default function MapPage() {
  const [filters, setFilters] = useLeadFilters();
  const [theme] = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const filtersRef = useRef<LeadFilters>(filters);
  const fittedRef = useRef(false);
  const selectedRef = useRef<number | null>(null);
  const [data, setData] = useState<MapResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<number | null>(null);

  const select = useCallback((id: number | null) => {
    const map = mapRef.current;
    if (map && map.getSource('leads')) {
      if (selectedRef.current !== null) map.setFeatureState({ source: 'leads', id: selectedRef.current }, { selected: false });
      if (id !== null) map.setFeatureState({ source: 'leads', id }, { selected: true });
    }
    selectedRef.current = id;
    setSelected(id);
  }, []);

  const load = useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;
    const b = map.getBounds();
    setLoading(true);
    try {
      const res = await api.get<MapResponse>('/leads/map', {
        ...filtersRef.current,
        west: Math.max(-180, b.getWest()),
        east: Math.min(180, b.getEast()),
        south: Math.max(-90, b.getSouth()),
        north: Math.min(90, b.getNorth()),
        zoom: map.getZoom(),
      });
      setError(null);
      setData(res);
      (map.getSource('leads') as GeoJSONSource | undefined)?.setData({
        type: 'FeatureCollection',
        features: res.points.map((p) => ({ type: 'Feature', id: p.id, geometry: { type: 'Point', coordinates: [p.lng, p.lat] }, properties: { id: p.id, name: p.name, waStatus: p.waStatus ?? 'pending' } })),
      });
      (map.getSource('cells') as GeoJSONSource | undefined)?.setData({
        type: 'FeatureCollection',
        features: res.cells.map((c, i) => ({ type: 'Feature', id: i, geometry: { type: 'Point', coordinates: [c.lng, c.lat] }, properties: { count: c.count } })),
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  /** Enquadra todos os resultados com coordenadas do filtro atual. */
  const fitToResults = useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;
    const res = await api.get<MapResponse>('/leads/map', { ...filtersRef.current, west: -180, east: 180, south: -90, north: 90, zoom: 2 });
    const coords = res.mode === 'points' ? res.points.map((p) => [p.lng, p.lat] as [number, number]) : res.cells.map((c) => [c.lng, c.lat] as [number, number]);
    if (!coords.length) return;
    const bounds = coords.reduce((acc, c) => acc.extend(c), new LngLatBounds(coords[0]!, coords[0]!));
    map.fitBounds(bounds as LngLatBoundsLike, { padding: 48, maxZoom: 15, duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 600 });
  }, []);

  // Cria o mapa uma vez. A limpeza abaixo cancela o único timer pendente do
  // debounce (cada chamada cancela o anterior) e map.remove() solta todos os
  // listeners registrados com map.on — a regra não acompanha essa reatribuição.
  // react-doctor-disable-next-line react-doctor/effect-needs-cleanup
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new MaplibreMap({
      container: containerRef.current,
      style: isDark(theme) ? STYLE_DARK : STYLE_LIGHT,
      center: INITIAL.center,
      zoom: INITIAL.zoom,
      attributionControl: { compact: false },
    });
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const debounced = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void load(), 250);
    };
    map.on('style.load', () => {
      addLayers(map);
      void load();
      if (!fittedRef.current) {
        fittedRef.current = true;
        void fitToResults();
      }
    });
    map.on('moveend', debounced);
    map.on('click', 'clusters', async (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const zoom = await (map.getSource('leads') as GeoJSONSource).getClusterExpansionZoom(f.properties.cluster_id as number);
      map.easeTo({ center: (f.geometry as unknown as PointGeometry).coordinates, zoom });
    });
    map.on('click', 'cells', (e) => {
      const f = e.features?.[0];
      if (f) map.easeTo({ center: (f.geometry as unknown as PointGeometry).coordinates, zoom: map.getZoom() + 2 });
    });
    map.on('click', 'points', (e) => {
      const id = e.features?.[0]?.properties?.id as number | undefined;
      if (id !== undefined) select(Number(id));
    });
    for (const layer of ['clusters', 'points', 'cells']) {
      map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
    }
    return () => {
      clearTimeout(timer);
      map.remove();
      mapRef.current = null;
    };
    // O mapa é criado uma única vez; tema e filtros têm efeitos próprios.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tema: troca o estilo base mantendo as camadas do aero
  useEffect(() => {
    mapRef.current?.setStyle(isDark(theme) ? STYLE_DARK : STYLE_LIGHT);
  }, [theme]);

  // Filtros: recarrega a área visível
  useEffect(() => {
    filtersRef.current = filters;
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [filters, load]);

  const flyTo = (p: { id: number; lat: number; lng: number }) => {
    select(p.id);
    mapRef.current?.easeTo({ center: [p.lng, p.lat], zoom: Math.max(mapRef.current.getZoom(), 15) });
  };
  const selectedPoint = data?.points.find((p) => p.id === selected) ?? null;

  return (
    <>
      <PageHeader
        title="Mapa"
        description="Visualização das coordenadas coletadas. A precisão depende dos dados retornados pelo Google Maps; o mapa não confirma localização."
        actions={
          <button type="button" className="btn btn-sm" onClick={() => void fitToResults()}>
            Ajustar aos resultados
          </button>
        }
      />
      <LeadFiltersBar filters={filters} onChange={setFilters} />
      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="relative h-[60vh] min-h-96 overflow-hidden rounded-box border border-base-300">
          <div ref={containerRef} className="h-full w-full" role="region" aria-label="Mapa dos estabelecimentos" />
          {loading ? <span className="loading loading-spinner loading-sm absolute left-3 top-3" aria-label="Carregando pontos" /> : null}
          <div className="absolute bottom-8 left-3 rounded-box bg-base-100/90 p-2 text-xs shadow">
            {Object.entries(WA_COLORS).map(([k, c]) => (
              <div key={k} className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-full" style={{ background: c }} aria-hidden="true" />
                {WA_STATUS_LABELS[k as WaStatus]}
              </div>
            ))}
          </div>
        </div>
        <aside className="flex max-h-[60vh] flex-col gap-3 overflow-hidden" aria-label="Resultados na área visível">
          {error ? <div className="alert alert-error alert-soft text-sm">{error}</div> : null}
          <div className="rounded-box border border-base-300 bg-base-100 p-3 text-sm">
            <p>
              <strong>{fmtNum(data?.total ?? 0)}</strong> estabelecimento(s) com coordenadas na área visível
              {data?.mode === 'grid' ? ' (agrupados no servidor; aproxime para ver os pontos)' : ''}.
            </p>
            <p className="mt-1 text-base-content/70">
              {fmtNum(data?.withoutCoords ?? 0)} sem coordenadas utilizáveis —{' '}
              <Link className="link" to={`/leads?${new URLSearchParams({ ...(Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])) as Record<string, string>), hasCoords: 'false' }).toString()}`}>
                ver na lista
              </Link>
              .
            </p>
          </div>
          {selectedPoint ? (
            <div className="rounded-box border border-primary bg-base-100 p-3 text-sm">
              <p className="font-medium">{selectedPoint.name}</p>
              <div className="mt-1">
                <WaBadge status={(selectedPoint.waStatus as WaStatus) ?? 'pending'} />
              </div>
              <button type="button" className="btn btn-primary btn-xs mt-2" onClick={() => setDetail(selectedPoint.id)}>
                Ver dados e andamento
              </button>
            </div>
          ) : null}
          <ul className="flex-1 overflow-y-auto rounded-box border border-base-300 bg-base-100">
            {(data?.points ?? []).slice(0, 300).map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => flyTo(p)} className={`w-full px-3 py-2 text-left text-sm hover:bg-base-200 ${selected === p.id ? 'bg-primary/10' : ''}`}>
                  {p.name}
                </button>
              </li>
            ))}
          </ul>
        </aside>
      </div>
      {detail !== null ? <LeadDetail id={detail} onClose={() => setDetail(null)} /> : null}
    </>
  );
}

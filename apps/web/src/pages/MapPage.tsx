import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { LngLatBounds, Map as MaplibreMap, NavigationControl, setWorkerUrl, type GeoJSONSource, type LngLatBoundsLike } from 'maplibre-gl';

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
import { MapLeadList } from '../components/MapLeadList';

const STYLE_LIGHT = 'https://tiles.openfreemap.org/styles/positron';
const STYLE_DARK = 'https://tiles.openfreemap.org/styles/dark';
const INITIAL: { center: [number, number]; zoom: number } = { center: [-47.9, -15.8], zoom: 3.5 };

const WA_COLORS: Record<WaStatus, string> = {
  found: '#22a06b',
  not_found: '#df5454',
  inconclusive: '#bf891b',
  invalid_format: '#a16bd5',
  pending: '#4b83e5',
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
  const brand = '#696c78';
  if (!map.getLayer('clusters'))
    map.addLayer({
      id: 'clusters',
      type: 'circle',
      source: 'leads',
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': brand,
        'circle-opacity': 0.85,
        'circle-radius': ['step', ['get', 'point_count'], 14, 20, 18, 100, 24, 500, 30],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#fff',
      },
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
        'circle-color': [
          'match',
          ['get', 'waStatus'],
          'found',
          WA_COLORS.found,
          'not_found',
          WA_COLORS.not_found,
          'inconclusive',
          WA_COLORS.inconclusive,
          'invalid_format',
          WA_COLORS.invalid_format,
          WA_COLORS.pending,
        ],
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

function bindMapEvents(map: MlMap, load: () => Promise<void>, cancelRequests: () => void, select: (id: number | null) => void, onStyleLoad: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const debounced = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void load(), 250);
  };
  const subscriptions = [map.on('style.load', onStyleLoad)];
  subscriptions.push(map.on('movestart', () => {
    clearTimeout(timer);
    cancelRequests();
  }));
  subscriptions.push(map.on('moveend', debounced));
  subscriptions.push(
    map.on('click', 'clusters', async (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const zoom = await (map.getSource('leads') as GeoJSONSource).getClusterExpansionZoom(f.properties.cluster_id as number);
      map.easeTo({ center: (f.geometry as unknown as PointGeometry).coordinates, zoom });
    }),
  );
  subscriptions.push(
    map.on('click', 'cells', (e) => {
      const f = e.features?.[0];
      if (f) map.easeTo({ center: (f.geometry as unknown as PointGeometry).coordinates, zoom: map.getZoom() + 2 });
    }),
  );
  subscriptions.push(
    map.on('click', 'points', (e) => {
      const id = e.features?.[0]?.properties?.id as number | undefined;
      if (id !== undefined) select(Number(id));
    }),
  );
  for (const layer of ['clusters', 'points', 'cells']) {
    subscriptions.push(map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer')));
    subscriptions.push(map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = '')));
  }
  return () => {
    clearTimeout(timer);
    subscriptions.forEach((subscription) => subscription.unsubscribe());
  };
}

export default function MapPage() {
  const [filters, setFilters] = useLeadFilters();
  const [theme] = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const loadController = useRef<AbortController | null>(null);
  const fitController = useRef<AbortController | null>(null);
  const filtersRef = useRef<LeadFilters>(filters);
  const fittedRef = useRef(false);
  const selectedRef = useRef<number | null>(null);
  const [data, setData] = useState<MapResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<number | null>(null);

  const cancelRequests = useCallback(() => {
    loadController.current?.abort();
    fitController.current?.abort();
  }, []);

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
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
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
      }, { signal: controller.signal });
      if (controller.signal.aborted || mapRef.current !== map) return;
      setError(null);
      setData(res);
      (map.getSource('leads') as GeoJSONSource | undefined)?.setData({
        type: 'FeatureCollection',
        features: res.points.map((p) => ({
          type: 'Feature',
          id: p.id,
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
          properties: { id: p.id, name: p.name, waStatus: p.waStatus ?? 'pending' },
        })),
      });
      (map.getSource('cells') as GeoJSONSource | undefined)?.setData({
        type: 'FeatureCollection',
        features: res.cells.map((c, i) => ({
          type: 'Feature',
          id: i,
          geometry: { type: 'Point', coordinates: [c.lng, c.lat] },
          properties: { count: c.count },
        })),
      });
    } catch (e) {
      if (!controller.signal.aborted && mapRef.current === map) setError(errorMessage(e));
    } finally {
      setLoading((current) => controller.signal.aborted || mapRef.current !== map ? current : false);
    }
  }, []);

  const fitToResults = useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;
    fitController.current?.abort();
    const controller = new AbortController();
    fitController.current = controller;
    try {
      const res = await api.get<MapResponse>('/leads/map', { ...filtersRef.current, west: -180, east: 180, south: -90, north: 90, zoom: 2 }, { signal: controller.signal });
      if (controller.signal.aborted || mapRef.current !== map) return;
      const coords = res.mode === 'points' ? res.points.map((p) => [p.lng, p.lat] as [number, number]) : res.cells.map((c) => [c.lng, c.lat] as [number, number]);
      setError(null);
      if (!coords.length) return;
      const bounds = coords.reduce((acc, c) => acc.extend(c), new LngLatBounds(coords[0]!, coords[0]!));
      map.fitBounds(bounds as LngLatBoundsLike, { padding: 48, maxZoom: 15, duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 600 });
    } catch (e) {
      if (!controller.signal.aborted && mapRef.current === map) setError(errorMessage(e));
    }
  }, []);

  const initialStyle = useEffectEvent(() => (isDark(theme) ? STYLE_DARK : STYLE_LIGHT));

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new MaplibreMap({
      container: containerRef.current,
      style: initialStyle(),
      center: INITIAL.center,
      zoom: INITIAL.zoom,
      attributionControl: { compact: false },
    });
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    const disconnect = bindMapEvents(map, load, cancelRequests, select, () => {
      addLayers(map);
      void load();
      if (!fittedRef.current) {
        fittedRef.current = true;
        void fitToResults();
      }
    });
    return () => {
      disconnect();
      cancelRequests();
      map.remove();
      mapRef.current = null;
    };
  }, [load, fitToResults, select, cancelRequests]);

  useEffect(() => {
    cancelRequests();
    mapRef.current?.setStyle(isDark(theme) ? STYLE_DARK : STYLE_LIGHT);
  }, [theme, cancelRequests]);

  useEffect(() => {
    filtersRef.current = filters;
    const t = setTimeout(() => void load(), 0);
    return () => {
      clearTimeout(t);
      cancelRequests();
    };
  }, [filters, load, cancelRequests]);

  const flyTo = (p: { id: number; lat: number; lng: number }) => {
    select(p.id);
    mapRef.current?.easeTo({ center: [p.lng, p.lat], zoom: Math.max(mapRef.current.getZoom(), 15) });
  };

  return (
    <>
      <PageHeader
        title="Mapa"
        actions={
          <button type="button" className="btn btn-sm" onClick={() => void fitToResults()}>
            Ajustar aos resultados
          </button>
        }
      />
      <LeadFiltersBar filters={filters} onChange={setFilters} />
      <div className="map-workspace">
        <div className="map-canvas">
          <div ref={containerRef} className="h-full w-full" role="region" aria-label="Mapa dos estabelecimentos" />
          {loading ? <span className="loading loading-spinner loading-sm absolute left-3 top-3" aria-label="Carregando pontos" /> : null}
          <div className="absolute bottom-8 left-3 rounded-box border border-base-300 bg-base-100 p-2 text-xs">
            {Object.entries(WA_COLORS).map(([k, c]) => (
              <div key={k} className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-full" style={{ background: c }} aria-hidden="true" />
                {WA_STATUS_LABELS[k as WaStatus]}
              </div>
            ))}
          </div>
        </div>
        <aside className="map-results" aria-label="Resultados na área visível">
          {error ? <div className="alert alert-error alert-soft text-sm">{error}</div> : null}
          <MapLeadList
            data={data}
            selected={selected}
            loading={loading}
            onLocate={flyTo}
            onOpen={(id) => {
              select(id);
              setDetail(id);
            }}
          />
        </aside>
      </div>
      {detail !== null ? <LeadDetail id={detail} onClose={() => setDetail(null)} /> : null}
    </>
  );
}

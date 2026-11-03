import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { api } from '../lib/api';
import type { LeadFilters, MapResponse } from '../lib/types';

const map = vi.hoisted(() => ({
  events: new Map<string, () => void>(),
  leads: { setData: vi.fn() },
  cells: { setData: vi.fn() },
  on: vi.fn(),
  getSource: vi.fn(),
  getLayer: vi.fn(() => true),
  getBounds: () => ({ getWest: () => -50, getEast: () => -40, getSouth: () => -20, getNorth: () => -10 }),
  getZoom: () => 7,
  addControl: vi.fn(),
  setStyle: vi.fn(),
  setFeatureState: vi.fn(),
  fitBounds: vi.fn(),
  remove: vi.fn(),
  easeTo: vi.fn(),
}));

vi.mock('maplibre-gl', () => ({
  Map: vi.fn(function () { return map; }),
  NavigationControl: vi.fn(function () { return {}; }),
  LngLatBounds: class { extend() { return this; } },
  setWorkerUrl: vi.fn(),
}));
vi.mock('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url', () => ({ default: 'worker' }));
vi.mock('../components/LeadFiltersBar', () => ({
  LeadFiltersBar: ({ onChange }: { onChange: (filters: Partial<LeadFilters>) => void }) => <input aria-label="Busca no mapa" onChange={(e) => onChange({ q: e.target.value })} />,
}));

import MapPage from './MapPage';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  map.events.clear();
  map.leads.setData.mockClear();
  map.cells.setData.mockClear();
  map.fitBounds.mockClear();
});

function response(name: string): MapResponse {
  return { mode: 'points', total: 1, withoutCoords: 0, points: [{ id: 1, lat: -15, lng: -45, name, waStatus: 'pending', stage: null }], cells: [] };
}

function setup() {
  vi.useFakeTimers();
  map.on.mockImplementation((event: string, callback: () => void) => {
    if (typeof callback === 'function') map.events.set(event, callback);
    return { unsubscribe: vi.fn() };
  });
  map.getSource.mockImplementation((source: string) => source === 'leads' ? map.leads : map.cells);
  const requests: { signal: AbortSignal; resolve: (data: MapResponse) => void; reject: (reason: Error) => void }[] = [];
  vi.spyOn(api, 'get').mockImplementation((_path, _query, options) => new Promise((resolve, reject) => {
    requests.push({ signal: options!.signal!, resolve, reject });
  }) as never);
  const view = render(<MemoryRouter><MapPage /></MemoryRouter>);
  return { requests, ...view };
}

describe('requisições do mapa', () => {
  it('descarta a resposta antiga mesmo se ela concluir depois da nova e cancela ao desmontar', async () => {
    const { requests, unmount } = setup();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    fireEvent.change(screen.getByRole('textbox', { name: 'Busca no mapa' }), { target: { value: 'nova' } });
    expect(requests[0]!.signal.aborted).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    await act(async () => requests[1]!.resolve(response('Resultado atual')));
    await act(async () => requests[0]!.resolve(response('Resultado antigo')));
    expect(screen.getByRole('button', { name: 'Localizar Resultado atual no mapa' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Localizar Resultado antigo no mapa' })).toBeNull();
    expect(map.leads.setData).toHaveBeenCalledTimes(1);
    act(() => map.events.get('moveend')?.());
    await act(async () => { await vi.advanceTimersByTimeAsync(251); });
    unmount();
    expect(requests[2]!.signal.aborted).toBe(true);
    await act(async () => requests[2]!.resolve(response('Após desmontar')));
    expect(map.leads.setData).toHaveBeenCalledTimes(1);
  });

  it('não deixa a conclusão de uma busca cancelada encerrar o carregamento atual', async () => {
    const { requests } = setup();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    fireEvent.change(screen.getByRole('textbox', { name: 'Busca no mapa' }), { target: { value: 'nova' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    await act(async () => requests[0]!.reject(new DOMException('Aborted', 'AbortError')));
    expect(screen.getByLabelText('Carregando pontos')).toBeTruthy();
    expect(screen.queryByText('Aborted')).toBeNull();
    await act(async () => requests[1]!.resolve(response('Atual')));
    expect(screen.queryByLabelText('Carregando pontos')).toBeNull();
  });

  it('cancela ajustes de enquadramento antigos ao repetir a ação, trocar filtros ou mover o mapa', async () => {
    const { requests } = setup();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    const fit = screen.getByRole('button', { name: 'Ajustar aos resultados' });
    fireEvent.click(fit);
    fireEvent.click(fit);
    expect(requests[1]!.signal.aborted).toBe(true);
    await act(async () => requests[2]!.resolve(response('Ajuste atual')));
    await act(async () => requests[1]!.resolve(response('Ajuste antigo')));
    expect(map.fitBounds).toHaveBeenCalledTimes(1);
    fireEvent.click(fit);
    fireEvent.change(screen.getByRole('textbox', { name: 'Busca no mapa' }), { target: { value: 'filtro' } });
    expect(requests[3]!.signal.aborted).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    fireEvent.click(fit);
    act(() => map.events.get('movestart')?.());
    expect(requests[4]!.signal.aborted).toBe(true);
    expect(requests[5]!.signal.aborted).toBe(true);
    await act(async () => requests[5]!.resolve(response('Ajuste durante movimento')));
    expect(map.fitBounds).toHaveBeenCalledTimes(1);
    fireEvent.click(fit);
    await act(async () => requests[6]!.reject(new Error('Falha ao ajustar')));
    expect(screen.getByText('Falha ao ajustar')).toBeTruthy();
  });
});

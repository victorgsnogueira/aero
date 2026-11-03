import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MapResponse } from '../lib/types';
import { MapLeadList } from './MapLeadList';

afterEach(cleanup);

const lead: MapResponse['points'][number] = { id: 42, name: 'Clínica Odontológica', lat: -23.1, lng: -45.9, waStatus: 'found', stage: 'proposal' };
const data: MapResponse = { mode: 'points', total: 1, withoutCoords: 0, points: [lead], cells: [] };

describe('leads do mapa', () => {
  it('exibe dados do lead e separa localizar no mapa de abrir o cadastro', () => {
    const onLocate = vi.fn();
    const onOpen = vi.fn();
    render(<MapLeadList data={data} selected={42} loading={false} onLocate={onLocate} onOpen={onOpen} />);
    const locate = screen.getByRole('button', { name: 'Localizar Clínica Odontológica no mapa' });
    expect(locate.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('WhatsApp encontrado')).toBeTruthy();
    expect(screen.getByText('Proposta')).toBeTruthy();
    fireEvent.click(locate);
    expect(onLocate).toHaveBeenCalledExactlyOnceWith(lead);
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Ver lead Clínica Odontológica' }));
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(42);
    expect(onLocate).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/coordenadas/)).toBeNull();
  });

  it('preserva a lista durante uma nova consulta sem perder a seleção', () => {
    render(<MapLeadList data={data} selected={42} loading onLocate={vi.fn()} onOpen={vi.fn()} />);
    expect(screen.getByRole('list', { name: 'Leads no mapa' }).getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('button', { name: 'Localizar Clínica Odontológica no mapa' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('distingue mapa vazio, pontos agrupados e carregamento inicial', () => {
    const props = { selected: null, onLocate: vi.fn(), onOpen: vi.fn() };
    const { rerender } = render(<MapLeadList {...props} data={null} loading />);
    expect(screen.getByRole('status').textContent).toContain('Buscando leads');
    rerender(<MapLeadList {...props} data={{ ...data, points: [], total: 0 }} loading={false} />);
    expect(screen.getByText('Nenhum lead nesta área')).toBeTruthy();
    rerender(<MapLeadList {...props} data={{ ...data, mode: 'grid', points: [], cells: [{ lat: -23.1, lng: -45.9, count: 100 }] }} loading={false} />);
    expect(screen.getByText('Aproxime o mapa')).toBeTruthy();
    expect(screen.queryByText('Nenhum lead nesta área')).toBeNull();
  });
});

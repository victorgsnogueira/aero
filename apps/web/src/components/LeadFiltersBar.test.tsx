import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '../lib/api';
import { LeadFiltersBar } from './LeadFiltersBar';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('não reinicia o debounce quando o pai renderiza novamente e usa o callback atual', async () => {
  vi.useFakeTimers();
  vi.spyOn(api, 'get').mockImplementation(async (path) => path === '/leads/facets' ? { categories: [], cities: [] } as never : path === '/scans' ? { items: [] } as never : [] as never);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const previous = vi.fn();
  const current = vi.fn();
  const view = (onChange: typeof previous) => <QueryClientProvider client={client}><LeadFiltersBar filters={{}} onChange={onChange} /></QueryClientProvider>;
  const { rerender } = render(view(previous));
  fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar' }), { target: { value: 'Dentista' } });
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  rerender(view(current));
  await act(async () => { await vi.advanceTimersByTimeAsync(150); });
  expect(previous).not.toHaveBeenCalled();
  expect(current).toHaveBeenCalledExactlyOnceWith({ q: 'Dentista' });
  cleanup();
  client.clear();
});

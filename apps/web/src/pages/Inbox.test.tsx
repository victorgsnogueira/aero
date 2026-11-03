import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '../lib/api';
import Inbox from './Inbox';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('busca de conversas', () => {
  it('aplica somente o último texto e reinicia a página junto com a busca, inclusive ao limpar', async () => {
    vi.useFakeTimers();
    const get = vi.spyOn(api, 'get').mockImplementation(async (_path, query) => ({ items: [], total: query?.q ? 1 : 80, page: query?.page, pageSize: 40, totalUnread: 0 }) as never);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(<QueryClientProvider client={client}><MemoryRouter><Inbox /></MemoryRouter></QueryClientProvider>);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    fireEvent.click(screen.getByRole('button', { name: 'Próxima' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(get.mock.calls.at(-1)?.[1]?.page).toBe(2);
    const input = screen.getByRole('searchbox', { name: 'Buscar conversa' });
    get.mockClear();
    fireEvent.change(input, { target: { value: 'Ma' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    fireEvent.change(input, { target: { value: 'Maria' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(299); });
    expect(get).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(2); });
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0]?.[1]).toMatchObject({ q: 'Maria', page: 1 });
    fireEvent.change(input, { target: { value: '' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(301); });
    expect(get.mock.calls.at(-1)?.[1]).toMatchObject({ q: undefined, page: 1 });
    cleanup();
    client.clear();
  });
});

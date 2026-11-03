import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { api, type ApiError } from './api';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('cancelamento de consultas', () => {
  it('aborta o fetch ao trocar a busca e ao desmontar, sem mostrar erro de cancelamento', async () => {
    const requests: { url: string; signal: AbortSignal; resolve: (response: Response) => void }[] = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit) => new Promise<Response>((resolve, reject) => {
      const signal = init.signal!;
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      requests.push({ url, signal, resolve });
    })));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    function Search({ term }: { term: string }) {
      const query = useQuery({ queryKey: ['search', term], queryFn: ({ signal }) => api.get<{ name: string }>('/leads', { q: term }, { signal }) });
      return <p>{query.isError ? 'Erro' : query.data?.name ?? 'Carregando'}</p>;
    }
    const view = (term: string) => <QueryClientProvider client={client}><Search term={term} /></QueryClientProvider>;
    const { rerender, unmount } = render(view('primeira'));
    rerender(view('segunda'));
    expect(requests.map((request) => request.url)).toEqual(['/api/leads?q=primeira', '/api/leads?q=segunda']);
    expect(requests[0]!.signal.aborted).toBe(true);
    expect(requests[1]!.signal.aborted).toBe(false);
    await act(async () => requests[1]!.resolve(new Response(JSON.stringify({ name: 'Resultado atual' }))));
    expect(await screen.findByText('Resultado atual')).toBeTruthy();
    expect(screen.queryByText('Erro')).toBeNull();
    rerender(view('terceira'));
    unmount();
    expect(requests[2]!.signal.aborted).toBe(true);
    client.clear();
  });

  it('preserva os erros da API em consultas sem opções de cancelamento', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_query', message: 'Busca inválida' }), { status: 400 })));
    await expect(api.get('/leads')).rejects.toMatchObject({ status: 400, code: 'invalid_query', message: 'Busca inválida' } satisfies Partial<ApiError>);
  });
});

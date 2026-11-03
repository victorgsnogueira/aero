import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import { useLiveUpdates } from './live';

class FakeEventSource extends EventTarget {
  static CLOSED = 2;
  static latest: FakeEventSource;
  readyState = 1;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  constructor() {
    super();
    FakeEventSource.latest = this;
  }
  emit(type: string) {
    this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify({ type }) }));
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('EventSource', FakeEventSource);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  const keys = [['metrics', 'overview', { city: 'São Paulo' }], ['metrics', 'campaigns'], ['attention'], ['leads'], ['inbox'], ['offers']];
  keys.forEach((key) => client.setQueryData(key, {}));
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const hook = renderHook(useLiveUpdates, { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
  return { client, invalidate, es: FakeEventSource.latest, ...hook };
}

describe('cache e eventos em tempo real', () => {
  it('atualiza as métricas em exibição uma única vez por lote de eventos', async () => {
    const { client, es } = setup();
    const queryFn = vi.fn(async () => ({ atualizado: true }));
    const queryKey = ['metrics', 'campaigns'];
    const observer = new QueryObserver(client, { queryKey, queryFn });
    const unsubscribe = observer.subscribe(() => undefined);
    act(() => {
      es.emit('message.updated');
      es.emit('conversation.updated');
      es.emit('opportunity.updated');
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(queryFn).toHaveBeenCalledOnce();
    expect(client.getQueryData(queryKey)).toEqual({ atualizado: true });
    unsubscribe();
    client.clear();
  });

  it.each(['scan.updated', 'conversation.updated', 'message.updated', 'campaign.updated', 'opportunity.updated', 'validation.updated'])(
    'invalida todas as variações das métricas com %s e agrupa eventos repetidos', async (type) => {
      const { client, invalidate, es } = setup();
      act(() => {
        es.emit(type);
        es.emit(type);
        es.emit(type);
      });
      expect(invalidate).not.toHaveBeenCalled();
      await act(async () => { await vi.advanceTimersByTimeAsync(250); });
      expect(invalidate.mock.calls.filter(([filters]) => filters?.queryKey?.[0] === 'metrics')).toHaveLength(1);
      expect(client.getQueryState(['metrics', 'overview', { city: 'São Paulo' }])?.isInvalidated).toBe(true);
      expect(client.getQueryState(['metrics', 'campaigns'])?.isInvalidated).toBe(true);
      expect(client.getQueryState(['offers'])?.isInvalidated).toBe(false);
      client.clear();
    },
  );

  it('recupera eventos perdidos após reconexão e descarta o lote pendente ao desmontar', async () => {
    const { client, invalidate, es, unmount } = setup();
    act(() => es.onopen?.());
    expect(invalidate).not.toHaveBeenCalled();
    act(() => es.onopen?.());
    expect(invalidate).toHaveBeenCalledExactlyOnceWith();
    expect(client.getQueryState(['offers'])?.isInvalidated).toBe(true);
    invalidate.mockClear();
    act(() => es.emit('message.updated'));
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(invalidate).not.toHaveBeenCalled();
    expect(es.close).toHaveBeenCalledOnce();
    client.clear();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Metrics } from '../lib/types';
import Dashboard from './Dashboard';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const rate = { numerator: 0, denominator: 0, value: null, denominatorLabel: 'contatos abordados' };
const metrics: Metrics = {
  collection: { companies: 95, newRecords: 95, duplicates: 0, phones: 84, waConfirmed: 0, waInconclusive: 0, waNotFound: 0 },
  outreach: {
    contactsApproached: 0,
    firstMessages: 0,
    deliveredConfirmed: 0,
    readConfirmed: 0,
    unknownResult: 0,
    failed: 0,
    contactsReplied: 0,
    contactsInterested: 0,
    contactsQualified: 0,
    contactsDeclined: 0,
    contactsNoReply: 0,
  },
  rates: { reply: rate, interest: rate, qualification: rate, deliveryConfirmed: rate, readConfirmed: rate, proposalAcceptance: rate },
  proposals: { sent: 0, accepted: 0, fullyPaid: 0 },
  money: { offered: {}, closed: {}, received: {} },
  stages: { presentation: 3 },
  lossReasons: [],
};

function setup(attention: Record<string, number> | Error) {
  vi.spyOn(api, 'get').mockImplementation(async (path) => {
    if (path === '/metrics/attention') {
      if (attention instanceof Error) throw attention;
      return attention as never;
    }
    const data: Record<string, unknown> = {
      '/metrics/overview': metrics,
      '/metrics/campaigns': { note: '', items: [] },
      '/campaigns': [],
      '/offers': [],
      '/settings': { missingForOutreach: [] },
      '/whatsapp/session': { status: 'connected' },
    };
    return data[path] as never;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('prioridade da visão geral', () => {
  it('aguarda a pausa na digitação da cidade, mantendo os seletores imediatos', async () => {
    vi.useFakeTimers();
    setup({});
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    fireEvent.click(screen.getByRole('button', { name: 'Filtros' }));
    const get = vi.mocked(api.get);
    get.mockClear();
    fireEvent.change(screen.getByRole('textbox', { name: 'Cidade' }), { target: { value: 'São' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    fireEvent.change(screen.getByRole('textbox', { name: 'Cidade' }), { target: { value: 'São Paulo' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(349); });
    expect(get).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(2); });
    expect(get.mock.calls.filter(([path]) => path === '/metrics/overview')).toHaveLength(1);
    expect(get).toHaveBeenCalledWith('/metrics/overview', { city: 'São Paulo' }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    get.mockClear();
    fireEvent.change(screen.getByLabelText('De'), { target: { value: '2026-10-01' } });
    expect(get.mock.calls.some(([path, query]) => path === '/metrics/overview' && query?.from === '2026-10-01' && query.city === 'São Paulo')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(351); });
    expect(get.mock.calls.at(-1)?.[1]?.city).toBeUndefined();
  });

  it('prioriza o atendimento real sobre a preparação da operação', async () => {
    setup({ awaiting_human: 3, unknown_sends: 1, unread: 0, overdue: 0 });
    const queue = await screen.findByRole('link', { name: /Aguardando seu atendimento/ });
    expect(queue.getAttribute('href')).toBe('/inbox?state=awaiting_human');
    expect(screen.getByRole('link', { name: /Envios para conferir/ }).getAttribute('href')).toBe('/inbox');
    expect(screen.queryByRole('heading', { name: 'Cadastre sua primeira oferta' })).toBeNull();
  });

  it('propõe um próximo passo concreto quando não há pendências', async () => {
    setup({ awaiting_human: 0, unknown_sends: 0, unread: 0, overdue: 0 });
    expect(await screen.findByRole('heading', { name: 'Cadastre sua primeira oferta' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Criar oferta' }).getAttribute('href')).toBe('/ofertas');
    expect(screen.getByRole('heading', { name: 'Andamento comercial' })).toBeTruthy();
    expect(screen.getByText('Mensagens e conversão').closest('details')?.open).toBe(false);
  });

  it('não apresenta operação em dia quando a consulta de pendências falha', async () => {
    setup(new Error('Não foi possível consultar pendências'));
    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { name: 'Seu atendimento está em dia' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Cadastre sua primeira oferta' })).toBeNull();
  });
});

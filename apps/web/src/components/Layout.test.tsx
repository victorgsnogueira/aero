import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Layout } from './Layout';

vi.mock('../lib/live', () => ({ useLiveUpdates: () => 'open' }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.removeItem('aero-theme');
  document.documentElement.removeAttribute('data-theme');
});

function RouteContent() {
  const location = useLocation();
  return (
    <>
      <p data-testid="route">{location.pathname}</p>
      <input aria-label="Campo de edição" />
    </>
  );
}

function setup() {
  vi.spyOn(api, 'get').mockImplementation(async (path) => (path.includes('session') ? { status: 'connected' } : { unread: 0 }) as never);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="*" element={<RouteContent />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

describe('navegação sem atalhos', () => {
  it('alterna o tema com um botão e persiste a escolha sem seletor ou status de conexão', async () => {
    const user = setup();
    expect(screen.queryByRole('combobox', { name: 'Tema' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Conectado' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Usar tema escuro' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('aero-dark');
    expect(localStorage.getItem('aero-theme')).toBe('aero-dark');
    await user.click(screen.getByRole('button', { name: 'Usar tema claro' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('aero');
    expect(localStorage.getItem('aero-theme')).toBe('aero');
  });

  it('resolve a preferência do sistema antes de alternar para o tema claro', async () => {
    const original = window.matchMedia;
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({ ...original(query), matches: true }));
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Usar tema claro' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('aero');
    expect(localStorage.getItem('aero-theme')).toBe('aero');
  });

  it('não intercepta sequências de teclas nem abre ajuda', async () => {
    const user = setup();
    await user.keyboard('gi gl ?');
    expect(screen.getByTestId('route').textContent).toBe('/');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: /Atalhos/ })).toBeNull();
  });

  it('preserva texto digitado', async () => {
    const user = setup();
    const field = screen.getByRole('textbox', { name: 'Campo de edição' });
    await user.type(field, 'gi gl ?');
    expect((field as HTMLInputElement).value).toBe('gi gl ?');
    expect(screen.getByTestId('route').textContent).toBe('/');
  });

  it('mantém acesso às páginas pelo menu', async () => {
    const user = setup();
    await user.click(screen.getByRole('link', { name: 'Caixa de entrada' }));
    expect(screen.getByTestId('route').textContent).toBe('/inbox');
    await user.click(screen.getByRole('link', { name: 'Base de leads' }));
    expect(screen.getByTestId('route').textContent).toBe('/leads');
  });
});

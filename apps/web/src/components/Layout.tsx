import { NavLink, Outlet, useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { api } from '../lib/api';
import { useLiveUpdates } from '../lib/live';
import { useTheme } from '../lib/theme';
import type { WaSession } from '../lib/types';
import { Logo } from './ui';
import { SessionBadge } from './status';

const NAV = [
  { to: '/', label: 'Visão geral', end: true },
  { to: '/varreduras', label: 'Varreduras' },
  { to: '/leads', label: 'Base de leads' },
  { to: '/mapa', label: 'Mapa' },
  { to: '/campanhas', label: 'Campanhas' },
  { to: '/ofertas', label: 'Ofertas' },
  { to: '/inbox', label: 'Caixa de entrada', badge: 'unread' as const },
  { to: '/oportunidades', label: 'Oportunidades' },
  { to: '/propostas', label: 'Propostas e pagamentos' },
  { to: '/configuracoes', label: 'Configurações' },
];

export function Layout() {
  const live = useLiveUpdates();
  const [theme, setTheme] = useTheme();
  const location = useLocation();
  const drawerRef = useRef<HTMLInputElement>(null);
  const session = useQuery({ queryKey: ['wa-session'], queryFn: () => api.get<WaSession>('/whatsapp/session'), refetchInterval: 60_000 });
  const attention = useQuery({ queryKey: ['attention'], queryFn: () => api.get<Record<string, number>>('/metrics/attention'), refetchInterval: 30_000 });

  // Fecha o menu lateral (mobile) ao navegar
  useEffect(() => {
    if (drawerRef.current) drawerRef.current.checked = false;
  }, [location.pathname]);

  return (
    <div className="drawer lg:drawer-open">
      <input id="nav-drawer" type="checkbox" className="drawer-toggle" ref={drawerRef} aria-label="Abrir menu" />
      <div className="drawer-content flex min-h-screen flex-col bg-base-200/40">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-base-300 bg-base-100/90 px-4 py-2 backdrop-blur">
          <label htmlFor="nav-drawer" className="btn btn-ghost btn-sm lg:hidden" aria-label="Abrir navegação">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </label>
          <span className="flex items-center gap-2 lg:hidden">
            <Logo size={22} />
            <span className="font-semibold">aero</span>
          </span>
          <div className="ml-auto flex items-center gap-2">
            {live !== 'open' ? (
              <span className="badge badge-ghost badge-sm" title="Atualização em tempo real">
                {live === 'connecting' ? 'Reconectando…' : 'Tempo real indisponível'}
              </span>
            ) : null}
            {session.data ? (
              <NavLink to="/configuracoes/whatsapp" className="hidden sm:inline-flex" title="Conexão do WhatsApp">
                <SessionBadge status={session.data.status} />
              </NavLink>
            ) : null}
            <label className="sr-only" htmlFor="theme-select">
              Tema
            </label>
            <select id="theme-select" className="select select-sm w-auto" value={theme} onChange={(e) => setTheme(e.target.value as typeof theme)}>
              <option value="system">Tema do sistema</option>
              <option value="aero">Claro</option>
              <option value="aero-dark">Escuro</option>
            </select>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 lg:px-8">
          <Outlet />
        </main>
      </div>
      <div className="drawer-side z-30">
        <label htmlFor="nav-drawer" aria-label="Fechar navegação" className="drawer-overlay" />
        <nav className="flex min-h-full w-64 flex-col border-r border-base-300 bg-base-100 px-3 py-4" aria-label="Navegação principal">
          <NavLink to="/" className="mb-6 flex items-center gap-2 px-2">
            <Logo size={34} />
            <span className="text-xl font-semibold tracking-tight">aero</span>
          </NavLink>
          <ul className="menu w-full gap-0.5 p-0">
            {NAV.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} end={item.end} className={({ isActive }) => (isActive ? 'menu-active font-medium' : '')}>
                  <span className="flex-1">{item.label}</span>
                  {item.badge === 'unread' && (attention.data?.unread ?? 0) > 0 ? (
                    <span className="badge badge-primary badge-sm" aria-label={`${attention.data?.unread} não lidas`}>
                      {attention.data?.unread}
                    </span>
                  ) : null}
                </NavLink>
              </li>
            ))}
          </ul>
          <p className="mt-auto px-2 pt-6 text-xs text-base-content/50">Uso exclusivo do proprietário.</p>
        </nav>
      </div>
    </div>
  );
}

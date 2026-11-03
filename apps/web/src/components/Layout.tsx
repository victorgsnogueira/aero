import { NavLink, Outlet, useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { api } from '../lib/api';
import { useLiveUpdates } from '../lib/live';
import { useResolvedTheme, useTheme } from '../lib/theme';
import { Logo } from './ui';
import { Icon, type IconName } from './Icon';

const NAV = [
  { to: '/', label: 'Visão geral', end: true, icon: 'overview' },
  { to: '/varreduras', label: 'Varreduras', icon: 'scan' },
  { to: '/leads', label: 'Base de leads', icon: 'users' },
  { to: '/mapa', label: 'Mapa', icon: 'map' },
  { to: '/campanhas', label: 'Campanhas', icon: 'campaign' },
  { to: '/ofertas', label: 'Ofertas', icon: 'offer' },
  { to: '/inbox', label: 'Caixa de entrada', badge: 'unread' as const, icon: 'inbox' },
  { to: '/oportunidades', label: 'Oportunidades', icon: 'pipeline' },
  { to: '/propostas', label: 'Propostas e pagamentos', icon: 'document' },
  { to: '/configuracoes', label: 'Configurações', icon: 'settings' },
];

export function Layout() {
  const live = useLiveUpdates();
  const [, setTheme] = useTheme();
  const resolvedTheme = useResolvedTheme();
  const location = useLocation();
  const isInbox = location.pathname === '/inbox' || location.pathname.startsWith('/inbox/');
  const drawerRef = useRef<HTMLInputElement>(null);
  const attention = useQuery({ queryKey: ['attention'], queryFn: ({ signal }) => api.get<Record<string, number>>('/metrics/attention', undefined, { signal }), refetchInterval: 30_000 });

  useEffect(() => {
    if (drawerRef.current) drawerRef.current.checked = false;
  }, [location.pathname]);

  return (
    <div className={`drawer lg:drawer-open app-shell ${isInbox ? 'inbox-shell' : ''}`}>
      <input id="nav-drawer" type="checkbox" className="drawer-toggle" ref={drawerRef} aria-label="Abrir menu" />
      <div className="drawer-content flex min-h-screen min-w-0 flex-col bg-base-100">
        <a href="#main-content" className="skip-link">
          Ir para o conteúdo
        </a>
        <header className="app-topbar">
          <label htmlFor="nav-drawer" className="btn btn-ghost btn-sm lg:hidden" aria-label="Abrir navegação">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </label>
          <span className="flex items-center gap-2 lg:hidden">
            <Logo size={22} />
            <span className="font-semibold">aero</span>
          </span>
          <div className="ml-auto flex items-center gap-2">
            {live !== 'open' ? (
              <span className="status-label" title="Atualização em tempo real">
                <Icon name="clock" />
                {live === 'connecting' ? 'Reconectando…' : 'Tempo real indisponível'}
              </span>
            ) : null}
            <button
              type="button"
              className="btn btn-ghost btn-sm theme-toggle"
              aria-label={resolvedTheme === 'aero-dark' ? 'Usar tema claro' : 'Usar tema escuro'}
              title={resolvedTheme === 'aero-dark' ? 'Usar tema claro' : 'Usar tema escuro'}
              onClick={() => setTheme(resolvedTheme === 'aero-dark' ? 'aero' : 'aero-dark')}
            >
              <Icon name={resolvedTheme === 'aero-dark' ? 'sun' : 'moon'} />
            </button>
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className="app-main">
          <Outlet />
        </main>
      </div>
      <div className="drawer-side z-30">
        <label htmlFor="nav-drawer" aria-label="Fechar navegação" className="drawer-overlay" />
        <nav className="app-nav" aria-label="Navegação principal">
          <NavLink to="/" className="app-brand">
            <Logo size={34} />
            <span className="text-xl font-semibold tracking-tight">aero</span>
          </NavLink>
          <ul className="menu w-full gap-0.5 p-0">
            {NAV.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} end={item.end} title={item.label} className={({ isActive }) => (isActive ? 'menu-active font-medium' : '')}>
                  <Icon name={item.icon as IconName} />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.badge === 'unread' && (attention.data?.unread ?? 0) > 0 ? (
                    <span className="nav-count" aria-label={`${attention.data?.unread} não lidas`}>
                      {attention.data?.unread}
                    </span>
                  ) : null}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  );
}

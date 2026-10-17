import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import { applyTheme } from './lib/theme';
import { Layout } from './components/Layout';
import { RouteError } from './components/RouteError';
import { ToastProvider } from './components/toast';
import { Loading } from './components/ui';
import { ApiError } from './lib/api';

applyTheme();

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Scans = lazy(() => import('./pages/Scans'));
const ScanDetail = lazy(() => import('./pages/ScanDetail'));
const Leads = lazy(() => import('./pages/Leads'));
const MapPage = lazy(() => import('./pages/MapPage'));
const Campaigns = lazy(() => import('./pages/Campaigns'));
const CampaignDetail = lazy(() => import('./pages/CampaignDetail'));
const Offers = lazy(() => import('./pages/Offers'));
const Inbox = lazy(() => import('./pages/Inbox'));
const Opportunities = lazy(() => import('./pages/Opportunities'));
const OpportunityDetail = lazy(() => import('./pages/OpportunityDetail'));
const Proposals = lazy(() => import('./pages/Proposals'));
const SettingsPage = lazy(() => import('./pages/Settings'));
const NotFound = lazy(() => import('./pages/NotFound'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
    mutations: { retry: false },
  },
});

const page = (el: React.ReactNode) => <Suspense fallback={<Loading />}>{el}</Suspense>;

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: page(<Dashboard />) },
      { path: 'varreduras', element: page(<Scans />) },
      { path: 'varreduras/:id', element: page(<ScanDetail />) },
      { path: 'leads', element: page(<Leads />) },
      { path: 'mapa', element: page(<MapPage />) },
      { path: 'campanhas', element: page(<Campaigns />) },
      { path: 'campanhas/:id', element: page(<CampaignDetail />) },
      { path: 'ofertas', element: page(<Offers />) },
      { path: 'inbox', element: page(<Inbox />) },
      { path: 'inbox/:id', element: page(<Inbox />) },
      { path: 'oportunidades', element: page(<Opportunities />) },
      { path: 'oportunidades/:id', element: page(<OpportunityDetail />) },
      { path: 'propostas', element: page(<Proposals />) },
      { path: 'configuracoes', element: page(<SettingsPage />) },
      { path: 'configuracoes/:tab', element: page(<SettingsPage />) },
      { path: '*', element: page(<NotFound />) },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);

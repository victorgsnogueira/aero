import { useState } from 'react';
import { Link } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { SERVICES, SERVICE_LABELS, type Service } from '@aero/shared';
import { api } from '../lib/api';
import type { Campaign, Metrics, Offer, Settings, WaSession } from '../lib/types';
import { ErrorAlert, Loading, PageHeader, QueryState } from '../components/ui';
import { CommercialOverview, OperationSupport, OverviewReports, type CampaignComparison } from '../components/DashboardSections';
import { Icon, type IconName } from '../components/Icon';
import { fmtNum } from '../lib/format';
import { useDebouncedValue } from '../lib/useDebouncedValue';

export default function Dashboard() {
  const [f, setF] = useState<{ from?: string; to?: string; service?: Service; campaignId?: number; city?: string }>({});
  const city = useDebouncedValue(f.city, 350);
  const metricsFilters = { ...f, city };
  const metrics = useQuery({
    queryKey: ['metrics', 'overview', metricsFilters],
    queryFn: ({ signal }) => api.get<Metrics>('/metrics/overview', metricsFilters, { signal }),
    placeholderData: keepPreviousData,
  });
  const attention = useQuery({ queryKey: ['attention'], queryFn: ({ signal }) => api.get<Record<string, number>>('/metrics/attention', undefined, { signal }) });
  const campaigns = useQuery({ queryKey: ['campaigns'], queryFn: ({ signal }) => api.get<Campaign[]>('/campaigns', undefined, { signal }) });
  const settings = useQuery({ queryKey: ['settings'], queryFn: ({ signal }) => api.get<Settings>('/settings', undefined, { signal }) });
  const offers = useQuery({ queryKey: ['offers'], queryFn: ({ signal }) => api.get<Offer[]>('/offers', undefined, { signal }) });
  const session = useQuery({ queryKey: ['wa-session'], queryFn: ({ signal }) => api.get<WaSession>('/whatsapp/session', undefined, { signal }) });
  const comparison = useQuery({
    queryKey: ['metrics', 'campaigns', f.from, f.to],
    queryFn: ({ signal }) =>
      api.get<CampaignComparison>('/metrics/campaigns', {
        from: f.from,
        to: f.to,
      }, { signal }),
  });

  const [filtersOpen, setFiltersOpen] = useState(false);
  const steps = [
    {
      done: !!settings.data && settings.data.missingForOutreach.length === 0,
      label: 'Identificação da operação',
      to: '/configuracoes',
      action: 'Completar identificação',
      title: 'Complete os dados da operação',
      hint: 'Preencha seu nome e empresa para preparar as abordagens.',
    },
    {
      done: (offers.data?.length ?? 0) > 0,
      label: 'Oferta cadastrada',
      to: '/ofertas',
      action: 'Criar oferta',
      title: 'Cadastre sua primeira oferta',
      hint: 'Defina o serviço e as condições que serão apresentados na campanha.',
    },
    {
      done: session.data?.status === 'connected',
      label: 'WhatsApp conectado',
      to: '/configuracoes/whatsapp',
      action: 'Conectar WhatsApp',
      title: 'Conecte seu WhatsApp',
      hint: 'Prepare a sessão do número usado na operação.',
    },
    {
      done: (campaigns.data?.length ?? 0) > 0,
      label: 'Campanha criada',
      to: '/campanhas',
      action: 'Criar campanha',
      title: 'Monte sua primeira campanha',
      hint: 'Escolha a oferta, adicione contatos e revise as mensagens antes de ativar.',
    },
  ];
  const setupReady = [settings, offers, session, campaigns].every((query) => query.isSuccess);
  const setupError = [settings, offers, session, campaigns].find((query) => query.isError)?.error;
  const nextStep = steps.find((step) => !step.done);
  const pending = [
    { key: 'awaiting_human', label: 'Aguardando seu atendimento', to: '/inbox?state=awaiting_human', icon: 'message' as IconName },
    { key: 'unknown_sends', label: 'Envios para conferir', to: '/inbox', icon: 'alert' as IconName },
    { key: 'overdue', label: 'Próximas ações atrasadas', to: '/oportunidades', icon: 'clock' as IconName },
    { key: 'unread', label: 'Conversas não lidas', to: '/inbox?unread=true', icon: 'inbox' as IconName },
  ].filter((item) => (attention.data?.[item.key] ?? 0) > 0);
  const filterCount = Object.values(f).filter((value) => value !== undefined && value !== '').length;

  return (
    <div className="overview-page">
      <PageHeader
        title="Visão geral"
        actions={
          <button
            type="button"
            className={`btn btn-sm ${filtersOpen ? 'is-open' : ''}`}
            aria-expanded={filtersOpen}
            aria-controls="overview-filters"
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            <Icon name="filter" />
            Filtros{filterCount ? <span className="neutral-count">{filterCount}</span> : null}
          </button>
        }
      />
      <section id="overview-filters" className="filter-bar dashboard-filters" aria-label="Filtros dos resultados" hidden={!filtersOpen}>
        <label>
          De
          <input type="date" className="input input-sm" value={f.from ?? ''} onChange={(e) => setF({ ...f, from: e.target.value || undefined })} />
        </label>
        <label>
          Até
          <input type="date" className="input input-sm" value={f.to ?? ''} onChange={(e) => setF({ ...f, to: e.target.value || undefined })} />
        </label>
        <label>
          Serviço
          <select
            className="select select-sm"
            value={f.service ?? ''}
            onChange={(e) => setF({ ...f, service: (e.target.value || undefined) as Service | undefined })}
          >
            <option value="">Todos</option>
            {SERVICES.map((service) => (
              <option key={service} value={service}>
                {SERVICE_LABELS[service]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Campanha
          <select
            className="select select-sm"
            value={f.campaignId ?? ''}
            onChange={(e) => setF({ ...f, campaignId: e.target.value ? Number(e.target.value) : undefined })}
          >
            <option value="">Todas</option>
            {(campaigns.data ?? []).map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Cidade
          <input className="input input-sm" value={f.city ?? ''} onChange={(e) => setF({ ...f, city: e.target.value || undefined })} placeholder="Qualquer" />
        </label>
        {filterCount ? (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setF({})}>
            Limpar filtros
          </button>
        ) : null}
      </section>

      <QueryState query={attention}>
        {(attentionData) => (
          <section className="priority-panel" aria-label="Prioridade de trabalho agora">
            {pending.length ? (
              <>
                <div className="priority-heading">
                  <Icon name="inbox" />
                  <h2>O que precisa de você</h2>
                  <span className="muted">Agora</span>
                </div>
                <div className="priority-queue">
                  {pending.map((item, index) => (
                    <Link key={item.key} to={item.to} className="priority-row">
                      <Icon name={item.icon} />
                      <span>{item.label}</span>
                      <strong>{fmtNum(attentionData[item.key])}</strong>
                      {index === 0 ? (
                        <span className="queue-action">
                          Abrir <Icon name="arrow" />
                        </span>
                      ) : (
                        <Icon name="chevron" />
                      )}
                    </Link>
                  ))}
                </div>
              </>
            ) : setupError ? (
              <ErrorAlert error={setupError} />
            ) : !setupReady ? (
              <Loading label="Conferindo a operação…" />
            ) : (
              <div className="next-action">
                <Icon name={nextStep ? 'offer' : 'complete'} />
                <div>
                  <h2>{nextStep?.title ?? 'Seu atendimento está em dia'}</h2>
                  <p>{nextStep?.hint ?? 'Nenhuma conversa ou ação pendente precisa da sua atenção agora.'}</p>
                </div>
                <Link to={nextStep?.to ?? '/inbox'} className="btn btn-primary btn-sm">
                  {nextStep?.action ?? 'Abrir caixa de entrada'}
                  <Icon name="arrow" />
                </Link>
              </div>
            )}
          </section>
        )}
      </QueryState>

      <QueryState query={metrics}>
        {(m) => (
          <>
            <div className="overview-workspace">
              <CommercialOverview metrics={m} comparison={comparison} />
              <OperationSupport metrics={m} attention={attention} steps={steps} setupReady={setupReady} setupError={setupError} />
            </div>
            <OverviewReports metrics={m} />
          </>
        )}
      </QueryState>
    </div>
  );
}

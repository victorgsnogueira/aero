import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { OPPORTUNITY_STAGES, OPPORTUNITY_STAGE_LABELS, SERVICES, SERVICE_LABELS, type Service } from '@aero/shared';
import { api } from '../lib/api';
import type { Opportunity, Paged } from '../lib/types';
import { PageHeader, QueryState } from '../components/ui';
import { fmtDate } from '../lib/format';
import { offerPrice } from '../lib/offer';
import { Icon } from '../components/Icon';

export default function Opportunities() {
  const [params, setParams] = useSearchParams();
  const service = (params.get('service') as Service | null) ?? undefined;
  const campaignId = params.get('campaignId') ? Number(params.get('campaignId')) : undefined;
  const q = useQuery({
    queryKey: ['opportunities', 'list', service, campaignId],
    queryFn: ({ signal }) => api.get<Paged<Opportunity>>('/opportunities', { service, campaignId, pageSize: 200 }, { signal }),
  });
  return (
    <>
      <PageHeader
        title="Oportunidades"
        actions={
          <>
            <label className="sr-only" htmlFor="opp-service">
              Serviço
            </label>
            <select
              id="opp-service"
              className="select select-sm w-auto"
              value={service ?? ''}
              onChange={(e) =>
                setParams((p) => {
                  const n = new URLSearchParams(p);
                  if (e.target.value) n.set('service', e.target.value);
                  else n.delete('service');
                  return n;
                })
              }
            >
              <option value="">Todos os serviços</option>
              {SERVICES.map((s) => (
                <option key={s} value={s}>
                  {SERVICE_LABELS[s]}
                </option>
              ))}
            </select>
          </>
        }
      />
      <QueryState query={q}>
        {(data) => (
          <>
            {data.total > data.items.length ? <p className="mb-2 text-xs text-base-content/60">Mostrando as {data.items.length} mais recentes de {data.total}.</p> : null}
            <div className="pipeline" role="region" aria-label="Funil de oportunidades" tabIndex={0}>
              {OPPORTUNITY_STAGES.map((stage) => {
                const items = data.items.filter((o) => o.stage === stage);
                return (
                  <section key={stage} className="pipeline-column" aria-label={OPPORTUNITY_STAGE_LABELS[stage]}>
                    <h2 className="flex items-center justify-between px-1 text-sm font-semibold">
                      {OPPORTUNITY_STAGE_LABELS[stage]} <span className="badge badge-ghost badge-sm">{items.length}</span>
                    </h2>
                    {items.map((o) => (
                      <Link key={o.id} to={`/oportunidades/${o.id}`} className="pipeline-item">
                        <p className="font-medium">{o.companyName}</p>
                        <p className="text-xs text-base-content/60">{SERVICE_LABELS[o.service]}</p>
                        {o.offerSnapshot ? <p className="mt-1 text-xs">{offerPrice(o.offerSnapshot)}</p> : null}
                        {o.nextAction ? (
                          <p className={`mt-1 text-xs ${o.nextActionDueAt && new Date(o.nextActionDueAt) < new Date() ? 'text-error' : 'text-base-content/70'}`}>
                            <Icon name="arrow" /> {o.nextAction} {o.nextActionDueAt ? `(${fmtDate(o.nextActionDueAt)})` : ''}
                          </p>
                        ) : null}
                        {o.stage === 'lost' && o.lostReason ? <p className="mt-1 text-xs text-base-content/60">Motivo: {o.lostReason}</p> : null}
                      </Link>
                    ))}
                  </section>
                );
              })}
            </div>
          </>
        )}
      </QueryState>
    </>
  );
}

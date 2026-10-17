import { useState } from 'react';
import { Link } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { SERVICES, SERVICE_LABELS, OPPORTUNITY_STAGES, OPPORTUNITY_STAGE_LABELS, CAMPAIGN_STATUS_LABELS, type Service, type CampaignStatus } from '@aero/shared';
import { api } from '../lib/api';
import type { Campaign, Metrics, Offer, Rate, Settings, WaSession } from '../lib/types';
import { PageHeader, QueryState, Stat } from '../components/ui';
import { fmtMoneyMap, fmtNum, fmtPct } from '../lib/format';

function RateStat({ label, rate }: { label: string; rate: Rate }) {
  return <Stat label={label} value={fmtPct(rate.value)} hint={`${fmtNum(rate.numerator)} de ${fmtNum(rate.denominator)} ${rate.denominatorLabel}`} />;
}

export default function Dashboard() {
  const [f, setF] = useState<{ from?: string; to?: string; service?: Service; campaignId?: number; city?: string }>({});
  const metrics = useQuery({ queryKey: ['metrics', 'overview', f], queryFn: () => api.get<Metrics>('/metrics/overview', f), placeholderData: keepPreviousData });
  const attention = useQuery({ queryKey: ['attention'], queryFn: () => api.get<Record<string, number>>('/metrics/attention') });
  const campaigns = useQuery({ queryKey: ['campaigns'], queryFn: () => api.get<Campaign[]>('/campaigns') });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get<Settings>('/settings') });
  const offers = useQuery({ queryKey: ['offers'], queryFn: () => api.get<Offer[]>('/offers') });
  const session = useQuery({ queryKey: ['wa-session'], queryFn: () => api.get<WaSession>('/whatsapp/session') });
  const comparison = useQuery({
    queryKey: ['metrics', 'campaigns', f.from, f.to],
    queryFn: () => api.get<{ note: string; items: { id: number; name: string; service: Service; status: CampaignStatus; metrics: Metrics }[] }>('/metrics/campaigns', { from: f.from, to: f.to }),
  });

  const steps = [
    { done: !(settings.data?.missingForOutreach.length ?? 1), label: 'Preencher nome e empresa em Configurações', to: '/configuracoes' },
    { done: (offers.data?.length ?? 0) > 0, label: 'Cadastrar uma oferta', to: '/ofertas' },
    { done: session.data?.status === 'connected', label: 'Conectar o WhatsApp', to: '/configuracoes/whatsapp' },
    { done: (campaigns.data?.length ?? 0) > 0, label: 'Criar uma campanha', to: '/campanhas' },
  ];
  const a = attention.data ?? {};

  return (
    <>
      <PageHeader title="Visão geral" description="Indicadores calculados a partir dos dados registrados. Taxas mostram numerador e denominador; valores são separados por moeda." />
      {steps.some((s) => !s.done) ? (
        <section className="mb-6 rounded-box border border-base-300 bg-base-100 p-4">
          <h2 className="mb-2 font-semibold">Primeiros passos</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {steps.map((s) => (
              <li key={s.label} className="flex items-center gap-2">
                <span aria-hidden="true">{s.done ? '✓' : '○'}</span>
                {s.done ? <span className="text-base-content/60 line-through">{s.label}</span> : <Link to={s.to} className="link">{s.label}</Link>}
                <span className="sr-only">{s.done ? '(concluído)' : '(pendente)'}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" aria-label="Requer atenção">
        <Link to="/inbox?state=awaiting_human" className="contents">
          <Stat label="Aguardando você" value={fmtNum(a.awaiting_human)} />
        </Link>
        <Link to="/inbox?unread=true" className="contents">
          <Stat label="Não lidas" value={fmtNum(a.unread)} />
        </Link>
        <Stat label="Envios agendados" value={fmtNum(a.scheduled)} />
        <Stat label="Resultado desconhecido" value={fmtNum(a.unknown_sends)} hint="Revise na caixa de entrada" />
        <Stat label="Varreduras ativas" value={fmtNum(a.running_scans)} />
        <Stat label="Ações atrasadas" value={fmtNum(a.overdue)} />
      </section>

      <section className="mb-4 flex flex-wrap items-end gap-2" aria-label="Filtros dos indicadores">
        <label className="flex flex-col text-xs">
          De
          <input type="date" className="input input-sm" value={f.from ?? ''} onChange={(e) => setF({ ...f, from: e.target.value || undefined })} />
        </label>
        <label className="flex flex-col text-xs">
          Até
          <input type="date" className="input input-sm" value={f.to ?? ''} onChange={(e) => setF({ ...f, to: e.target.value || undefined })} />
        </label>
        <label className="flex flex-col text-xs">
          Serviço
          <select className="select select-sm" value={f.service ?? ''} onChange={(e) => setF({ ...f, service: (e.target.value || undefined) as Service | undefined })}>
            <option value="">Todos</option>
            {SERVICES.map((s) => (
              <option key={s} value={s}>
                {SERVICE_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs">
          Campanha
          <select className="select select-sm" value={f.campaignId ?? ''} onChange={(e) => setF({ ...f, campaignId: e.target.value ? Number(e.target.value) : undefined })}>
            <option value="">Todas</option>
            {(campaigns.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs">
          Cidade
          <input className="input input-sm" value={f.city ?? ''} onChange={(e) => setF({ ...f, city: e.target.value || undefined })} placeholder="Qualquer" />
        </label>
      </section>

      <QueryState query={metrics}>
        {(m) => (
          <div className="flex flex-col gap-6">
            <section>
              <h2 className="mb-2 font-semibold">Coleta</h2>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
                <Stat label="Estabelecimentos" value={fmtNum(m.collection.companies)} />
                <Stat label="Novos" value={fmtNum(m.collection.newRecords)} />
                <Stat label="Duplicados" value={fmtNum(m.collection.duplicates)} />
                <Stat label="Telefones" value={fmtNum(m.collection.phones)} />
                <Stat label="WhatsApp confirmado" value={fmtNum(m.collection.waConfirmed)} />
                <Stat label="Inconclusivos" value={fmtNum(m.collection.waInconclusive)} />
                <Stat label="Sem WhatsApp" value={fmtNum(m.collection.waNotFound)} />
              </div>
            </section>
            <section>
              <h2 className="mb-2 font-semibold">Abordagem e respostas (contatos únicos)</h2>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label="Contatos abordados" value={fmtNum(m.outreach.contactsApproached)} hint={`${fmtNum(m.outreach.firstMessages)} primeiras mensagens`} />
                <RateStat label="Entrega confirmada" rate={m.rates.deliveryConfirmed} />
                <RateStat label="Leitura confirmada" rate={m.rates.readConfirmed} />
                <Stat label="Resultado desconhecido / falha" value={`${fmtNum(m.outreach.unknownResult)} / ${fmtNum(m.outreach.failed)}`} />
                <RateStat label="Responderam" rate={m.rates.reply} />
                <RateStat label="Interessados" rate={m.rates.interest} />
                <RateStat label="Qualificados" rate={m.rates.qualification} />
                <Stat label="Recusas / sem resposta" value={`${fmtNum(m.outreach.contactsDeclined)} / ${fmtNum(m.outreach.contactsNoReply)}`} />
              </div>
              <p className="mt-2 text-xs text-base-content/60">Entregas e leituras contam apenas confirmações recebidas do WhatsApp; ausência de confirmação não significa falha.</p>
            </section>
            <section>
              <h2 className="mb-2 font-semibold">Propostas, vendas e pagamentos</h2>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                <Stat label="Propostas enviadas" value={fmtNum(m.proposals.sent)} />
                <RateStat label="Propostas aceitas" rate={m.rates.proposalAcceptance} />
                <Stat label="Totalmente pagas" value={fmtNum(m.proposals.fullyPaid)} />
                <Stat label="Valor ofertado" value={<span className="text-lg">{fmtMoneyMap(m.money.offered)}</span>} />
                <Stat label="Valor fechado" value={<span className="text-lg">{fmtMoneyMap(m.money.closed)}</span>} />
                <Stat label="Valor recebido" value={<span className="text-lg">{fmtMoneyMap(m.money.received)}</span>} />
              </div>
            </section>
            <section className="grid gap-4 md:grid-cols-2">
              <div className="rounded-box border border-base-300 bg-base-100 p-4">
                <h2 className="mb-2 font-semibold">Oportunidades por etapa</h2>
                <ul className="flex flex-col gap-1 text-sm">
                  {OPPORTUNITY_STAGES.map((s) => (
                    <li key={s} className="flex justify-between">
                      <span>{OPPORTUNITY_STAGE_LABELS[s]}</span>
                      <span className="tabular-nums">{fmtNum(m.stages[s] ?? 0)}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-box border border-base-300 bg-base-100 p-4">
                <h2 className="mb-2 font-semibold">Motivos de perda</h2>
                {m.lossReasons.length === 0 ? <p className="text-sm text-base-content/60">Nenhuma perda registrada.</p> : null}
                <ul className="flex flex-col gap-1 text-sm">
                  {m.lossReasons.map((r) => (
                    <li key={r.reason} className="flex justify-between gap-2">
                      <span className="truncate">{r.reason}</span>
                      <span className="tabular-nums">{fmtNum(r.count)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          </div>
        )}
      </QueryState>

      <section className="mt-8">
        <h2 className="mb-1 font-semibold">Por campanha</h2>
        <p className="mb-2 text-xs text-base-content/60">{comparison.data?.note}</p>
        {comparison.data?.items.length ? (
          <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>Campanha</th>
                  <th>Estado</th>
                  <th className="text-right">Abordados</th>
                  <th className="text-right">Responderam</th>
                  <th className="text-right">Interessados</th>
                  <th className="text-right">Qualificados</th>
                  <th className="text-right">Aceitas</th>
                  <th className="text-right">Recebido</th>
                </tr>
              </thead>
              <tbody>
                {comparison.data.items.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link to={`/campanhas/${c.id}`} className="link link-hover">
                        {c.name}
                      </Link>
                    </td>
                    <td>{CAMPAIGN_STATUS_LABELS[c.status]}</td>
                    <td className="text-right tabular-nums">{fmtNum(c.metrics.outreach.contactsApproached)}</td>
                    <td className="text-right tabular-nums">
                      {fmtNum(c.metrics.outreach.contactsReplied)} <span className="text-xs text-base-content/60">({fmtPct(c.metrics.rates.reply.value)})</span>
                    </td>
                    <td className="text-right tabular-nums">{fmtNum(c.metrics.outreach.contactsInterested)}</td>
                    <td className="text-right tabular-nums">{fmtNum(c.metrics.outreach.contactsQualified)}</td>
                    <td className="text-right tabular-nums">{fmtNum(c.metrics.proposals.accepted)}</td>
                    <td className="text-right">{fmtMoneyMap(c.metrics.money.received)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-base-content/60">Sem campanhas.</p>
        )}
      </section>
    </>
  );
}

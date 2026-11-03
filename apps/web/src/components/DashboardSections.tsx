import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { UseQueryResult } from '@tanstack/react-query';
import { OPPORTUNITY_STAGES, OPPORTUNITY_STAGE_LABELS, type Service, type CampaignStatus } from '@aero/shared';
import type { Metrics, Rate } from '../lib/types';
import { ErrorAlert, Loading, QueryState } from './ui';
import { CampaignStatusBadge } from './status';
import { Icon } from './Icon';
import { fmtMoneyMap, fmtNum, fmtPct } from '../lib/format';

export interface CampaignComparison {
  note: string;
  items: { id: number; name: string; service: Service; status: CampaignStatus; metrics: Metrics }[];
}

export interface DashboardSetupStep {
  done: boolean;
  label: string;
  to: string;
  action: string;
  title: string;
  hint: string;
}

function DataRow({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="data-row">
      <dt>
        {label}
        {hint ? <span className="data-hint">{hint}</span> : null}
      </dt>
      <dd>{value}</dd>
    </div>
  );
}

function RateRow({ label, rate }: { label: string; rate: Rate }) {
  return <DataRow label={label} value={fmtPct(rate.value)} hint={`${fmtNum(rate.numerator)} de ${fmtNum(rate.denominator)} ${rate.denominatorLabel}`} />;
}

export function CommercialOverview({ metrics: m, comparison }: { metrics: Metrics; comparison: UseQueryResult<CampaignComparison> }) {
  return (
    <section className="commercial-workspace" aria-label="Andamento comercial">
      <div className="section-heading">
        <h2>Andamento comercial</h2>
        <Link to="/oportunidades">
          Oportunidades
          <Icon name="arrow" />
        </Link>
      </div>
      <div className="commercial-split">
        <dl className="stage-ledger">
          {OPPORTUNITY_STAGES.map((stage) => (
            <div key={stage} className="stage-row">
              <dt>
                <Icon name={stage === 'won' ? 'complete' : stage === 'lost' ? 'cancelled' : 'circle'} />
                {OPPORTUNITY_STAGE_LABELS[stage]}
              </dt>
              <dd>{fmtNum(m.stages[stage] ?? 0)}</dd>
            </div>
          ))}
        </dl>
        <div className="commercial-results">
          <div className="received-total">
            <span>Valor recebido</span>
            <strong>{fmtMoneyMap(m.money.received)}</strong>
          </div>
          <dl>
            <DataRow label="Propostas enviadas" value={fmtNum(m.proposals.sent)} />
            <DataRow label="Aceitas" value={fmtNum(m.proposals.accepted)} />
            <DataRow label="Totalmente pagas" value={fmtNum(m.proposals.fullyPaid)} />
            <DataRow label="Valor fechado" value={fmtMoneyMap(m.money.closed)} />
          </dl>
        </div>
      </div>
      <div className="section-heading campaign-heading">
        <h2>Campanhas no período</h2>
        <Link to="/campanhas">
          Ver campanhas
          <Icon name="arrow" />
        </Link>
      </div>
      <QueryState query={comparison}>
        {(comparisonData) =>
          comparisonData.items.length ? (
            <div className="data-table">
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
                  {comparisonData.items.map((campaign) => (
                    <tr key={campaign.id}>
                      <td>
                        <Link to={`/campanhas/${campaign.id}`}>{campaign.name}</Link>
                      </td>
                      <td>
                        <CampaignStatusBadge status={campaign.status} />
                      </td>
                      <td className="text-right">{fmtNum(campaign.metrics.outreach.contactsApproached)}</td>
                      <td className="text-right">
                        {fmtNum(campaign.metrics.outreach.contactsReplied)} <span className="muted">({fmtPct(campaign.metrics.rates.reply.value)})</span>
                      </td>
                      <td className="text-right">{fmtNum(campaign.metrics.outreach.contactsInterested)}</td>
                      <td className="text-right">{fmtNum(campaign.metrics.outreach.contactsQualified)}</td>
                      <td className="text-right">{fmtNum(campaign.metrics.proposals.accepted)}</td>
                      <td className="text-right">{fmtMoneyMap(campaign.metrics.money.received)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="quiet-empty">
              <Icon name="campaign" />
              <span>Nenhuma campanha criada</span>
              <Link to="/campanhas">
                Criar campanha
                <Icon name="arrow" />
              </Link>
            </div>
          )
        }
      </QueryState>
    </section>
  );
}

export function OperationSupport({
  metrics: m,
  attention,
  steps,
  setupReady,
  setupError,
}: {
  metrics: Metrics;
  attention: UseQueryResult<Record<string, number>>;
  steps: DashboardSetupStep[];
  setupReady: boolean;
  setupError: unknown;
}) {
  return (
    <aside className="overview-sidebar" aria-label="Apoio à operação">
      <section>
        <div className="section-heading">
          <h2>Base de contatos</h2>
          <Link to="/leads" aria-label="Abrir base de contatos">
            <Icon name="arrow" />
          </Link>
        </div>
        <dl>
          <DataRow label="Estabelecimentos" value={fmtNum(m.collection.companies)} />
          <DataRow label="Telefones coletados" value={fmtNum(m.collection.phones)} />
          <DataRow label="WhatsApps confirmados" value={fmtNum(m.collection.waConfirmed)} />
        </dl>
        <Link to="/varreduras" className="sidebar-action">
          <Icon name="scan" />
          Ver varreduras
          <Icon name="arrow" />
        </Link>
      </section>
      <section className="operation-section">
        <div className="section-heading">
          <h2>Operação</h2>
          <Link to="/configuracoes/diagnostico" aria-label="Abrir diagnóstico">
            <Icon name="settings" />
          </Link>
        </div>
        <QueryState query={attention}>
          {(a) => (
            <dl>
              <DataRow label="Envios agendados" value={fmtNum(a.scheduled)} />
              <DataRow label="Varreduras ativas" value={fmtNum(a.running_scans)} />
            </dl>
          )}
        </QueryState>
        {setupError ? (
          <ErrorAlert error={setupError} />
        ) : !setupReady ? (
          <Loading />
        ) : (
          <ul className="preparation-list">
            {steps.map((step) => (
              <li key={step.label}>
                <Icon name={step.done ? 'check' : 'circle'} />
                <Link to={step.to} className={step.done ? 'muted' : ''}>
                  {step.label}
                </Link>
                <span className="sr-only">{step.done ? 'Concluído' : 'Pendente'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}

export function OverviewReports({ metrics: m }: { metrics: Metrics }) {
  return (
    <div className="overview-reports">
      <details className="report-disclosure">
        <summary>
          <Icon name="scan" />
          <span>Coleta e validação</span>
          <span className="muted">{fmtNum(m.collection.companies)} estabelecimentos</span>
          <Icon name="chevron" />
        </summary>
        <dl className="report-columns">
          <DataRow label="Novos" value={fmtNum(m.collection.newRecords)} />
          <DataRow label="Duplicados" value={fmtNum(m.collection.duplicates)} />
          <DataRow label="WhatsApp confirmado" value={fmtNum(m.collection.waConfirmed)} />
          <DataRow label="Inconclusivos" value={fmtNum(m.collection.waInconclusive)} />
          <DataRow label="Sem WhatsApp" value={fmtNum(m.collection.waNotFound)} />
        </dl>
      </details>
      <details className="report-disclosure">
        <summary>
          <Icon name="message" />
          <span>Mensagens e conversão</span>
          <span className="muted">{fmtNum(m.outreach.contactsApproached)} contatos abordados</span>
          <Icon name="chevron" />
        </summary>
        <dl className="report-columns">
          <DataRow label="Contatos abordados" value={fmtNum(m.outreach.contactsApproached)} />
          <DataRow label="Primeiras mensagens" value={fmtNum(m.outreach.firstMessages)} />
          <RateRow label="Entrega confirmada" rate={m.rates.deliveryConfirmed} />
          <RateRow label="Leitura confirmada" rate={m.rates.readConfirmed} />
          <DataRow label="Resultado desconhecido" value={fmtNum(m.outreach.unknownResult)} />
          <DataRow label="Falhas" value={fmtNum(m.outreach.failed)} />
          <RateRow label="Responderam" rate={m.rates.reply} />
          <RateRow label="Interessados" rate={m.rates.interest} />
          <RateRow label="Qualificados" rate={m.rates.qualification} />
          <DataRow label="Recusas" value={fmtNum(m.outreach.contactsDeclined)} />
          <DataRow label="Sem resposta" value={fmtNum(m.outreach.contactsNoReply)} />
        </dl>
        <p className="report-note">Entregas e leituras contam apenas confirmações recebidas do WhatsApp; ausência de confirmação não significa falha.</p>
      </details>
      <details className="report-disclosure">
        <summary>
          <Icon name="document" />
          <span>Propostas e pagamentos</span>
          <span className="muted">{fmtNum(m.proposals.sent)} propostas enviadas</span>
          <Icon name="chevron" />
        </summary>
        <dl className="report-columns">
          <RateRow label="Propostas aceitas" rate={m.rates.proposalAcceptance} />
          <DataRow label="Valor ofertado" value={fmtMoneyMap(m.money.offered)} />
          <DataRow label="Valor fechado" value={fmtMoneyMap(m.money.closed)} />
          <DataRow label="Valor recebido" value={fmtMoneyMap(m.money.received)} />
        </dl>
      </details>
      <details className="report-disclosure">
        <summary>
          <Icon name="cancelled" />
          <span>Motivos de perda</span>
          <Icon name="chevron" />
        </summary>
        {m.lossReasons.length ? (
          <dl>
            {m.lossReasons.map((reason) => (
              <DataRow key={reason.reason} label={reason.reason} value={fmtNum(reason.count)} />
            ))}
          </dl>
        ) : (
          <p className="report-note">Nenhuma perda registrada.</p>
        )}
      </details>
    </div>
  );
}

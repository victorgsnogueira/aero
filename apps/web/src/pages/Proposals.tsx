import { useState } from 'react';
import { Link } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { PROPOSAL_STATUSES, PROPOSAL_STATUS_LABELS, type OpportunityStage, type ProposalStatus } from '@aero/shared';
import { api } from '../lib/api';
import type { Paged, Proposal } from '../lib/types';
import { EmptyState, PageHeader, Pagination, QueryState } from '../components/ui';
import { PaymentBadge, ProposalBadge, StageBadge } from '../components/status';
import { fmtDate, formatMoney } from '../lib/format';

type Row = Proposal & { opportunityTitle: string; stage: OpportunityStage; companyName: string };

export default function Proposals() {
  const [status, setStatus] = useState<ProposalStatus | ''>('');
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['opportunities', 'proposals', status, page],
    queryFn: () => api.get<Paged<Row>>('/opportunities/proposals', { status: status || undefined, page, pageSize: 50 }),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <PageHeader
        title="Propostas e pagamentos"
        description="Proposta aceita e pagamento confirmado são registros distintos. Pagamentos são lançados manualmente; não há gateway de pagamento nesta versão."
        actions={
          <>
            <label className="sr-only" htmlFor="prop-status">
              Situação
            </label>
            <select id="prop-status" className="select select-sm w-auto" value={status} onChange={(e) => { setStatus(e.target.value as ProposalStatus | ''); setPage(1); }}>
              <option value="">Todas</option>
              {PROPOSAL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {PROPOSAL_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </>
        }
      />
      <QueryState query={q}>
        {(data) =>
          data.items.length === 0 ? (
            <EmptyState title="Nenhuma proposta" description="Crie propostas a partir de uma oportunidade." action={<Link to="/oportunidades" className="btn btn-sm">Ir para oportunidades</Link>} />
          ) : (
            <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>Empresa / proposta</th>
                    <th className="text-right">Valor</th>
                    <th>Situação</th>
                    <th>Pagamento</th>
                    <th>Etapa</th>
                    <th>Validade</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <Link to={`/oportunidades/${p.opportunityId}`} className="link link-hover font-medium">
                          {p.companyName}
                        </Link>
                        <p className="text-xs text-base-content/60">{p.title}</p>
                      </td>
                      <td className="text-right tabular-nums">
                        {formatMoney(p.amountCents, p.currency)}
                        {p.setupCents ? <p className="text-xs text-base-content/60">+ {formatMoney(p.setupCents, p.currency)} implantação</p> : null}
                        {p.monthlyCents ? <p className="text-xs text-base-content/60">{formatMoney(p.monthlyCents, p.currency)}/mês</p> : null}
                      </td>
                      <td>
                        <ProposalBadge status={p.status} />
                      </td>
                      <td>
                        {p.status === 'accepted' ? (
                          <>
                            <PaymentBadge status={p.paymentStatus} />
                            <p className="text-xs text-base-content/60">recebido {formatMoney(p.receivedCents, p.currency)}</p>
                          </>
                        ) : (
                          <span className="text-xs text-base-content/50">—</span>
                        )}
                      </td>
                      <td>
                        <StageBadge stage={p.stage} />
                      </td>
                      <td className="text-xs">{fmtDate(p.validUntil)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </QueryState>
      {q.data ? <Pagination page={page} pageSize={q.data.pageSize} total={q.data.total} onChange={setPage} /> : null}
    </>
  );
}

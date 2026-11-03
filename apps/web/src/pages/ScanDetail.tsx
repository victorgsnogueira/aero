import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SCAN_MODE_LABELS, SCAN_TARGET_LABELS } from '@aero/shared';
import { api, errorMessage } from '../lib/api';
import type { Scan, ScanUnit } from '../lib/types';
import { PageHeader, QueryState, Stat } from '../components/ui';
import { ScanStatusBadge, UnitStatusBadge } from '../components/status';
import { useToast } from '../components/toast';
import { fmtDateTime, fmtNum } from '../lib/format';

const ACTIVE = ['queued', 'running', 'pausing', 'cancelling'];

export default function ScanDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: ['scans', 'detail', id],
    queryFn: ({ signal }) => api.get<{ scan: Scan; units: ScanUnit[] }>(`/scans/${id}`, undefined, { signal }),
    refetchInterval: (query) => (query.state.data && ACTIVE.includes(query.state.data.scan.status) ? 5000 : false),
  });
  const act = useMutation({
    mutationFn: (action: string) => api.post<Scan>(`/scans/${id}/${action}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['scans'] }),
    onError: (e) => toast('error', errorMessage(e)),
  });
  const validate = useMutation({
    mutationFn: () => api.post('/leads/validate', { scanId: Number(id) }),
    onSuccess: () => toast('info', 'Validação de WhatsApp enfileirada para os números desta varredura'),
    onError: (e) => toast('error', errorMessage(e)),
  });

  return (
    <QueryState query={q}>
      {({ scan: s, units }) => {
        const pct = Math.min(100, Math.round((s.targetProgress / Math.max(1, s.targetCount)) * 100));
        return (
          <>
            <PageHeader
              title={s.name}
              description={
                <>
                  {SCAN_MODE_LABELS[s.mode]} · {s.regionLabel} · termos: {s.keywords.join(', ')}
                </>
              }
              actions={
                <>
                  <ScanStatusBadge status={s.status} />
                  {s.status === 'draft' ? (
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => act.mutate('start')} disabled={act.isPending}>
                      Iniciar
                    </button>
                  ) : null}
                  {['queued', 'running'].includes(s.status) ? (
                    <button type="button" className="btn btn-sm" onClick={() => act.mutate('pause')} disabled={act.isPending}>
                      Pausar
                    </button>
                  ) : null}
                  {['paused', 'partial', 'failed'].includes(s.status) ? (
                    <button type="button" className="btn btn-sm" onClick={() => act.mutate('resume')} disabled={act.isPending}>
                      Retomar
                    </button>
                  ) : null}
                  {['draft', 'queued', 'running', 'pausing', 'paused'].includes(s.status) ? (
                    <button type="button" className="btn btn-error btn-outline btn-sm" onClick={() => act.mutate('cancel')} disabled={act.isPending}>
                      Cancelar
                    </button>
                  ) : null}
                </>
              }
            />
            <section className="mb-6 border-y border-base-300 py-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium">
                  Meta: {fmtNum(s.targetProgress)} de {fmtNum(s.targetCount)} {SCAN_TARGET_LABELS[s.targetKind].toLowerCase()}
                </p>
                <p className="text-sm text-base-content/60">
                  Início {fmtDateTime(s.startedAt)} · término {fmtDateTime(s.finishedAt)}
                </p>
              </div>
              <progress className="progress progress-primary mt-2 w-full" value={pct} max={100} aria-label="Progresso da meta" />
              {s.statusReason ? <p className="mt-2 text-sm">{s.statusReason}</p> : null}
              {s.lastError ? <p className="mt-1 text-sm text-warning">{s.lastError}</p> : null}
            </section>
            <div className="metric-grid mb-6">
              <Stat label="Estabelecimentos" value={fmtNum(s.placesFound)} />
              <Stat label="Telefones encontrados" value={fmtNum(s.phonesFound)} />
              <Stat label="Novos registros" value={fmtNum(s.newRecords)} />
              <Stat label="Duplicados" value={fmtNum(s.duplicates)} hint="Já na base ou repetidos na varredura" />
              <Stat label="Números únicos válidos" value={fmtNum(s.uniquePhones)} />
              <Stat label="WhatsApps confirmados" value={fmtNum(s.waConfirmed)} />
              <Stat label="Verificações inconclusivas" value={fmtNum(s.waInconclusive)} hint="Falha não significa inexistência" />
              <Stat label="Excedentes" value={fmtNum(s.surplus)} hint="Salvos, fora da meta" />
            </div>
            <div className="mb-3 flex flex-wrap gap-2">
              <Link to={`/leads?scanId=${s.id}`} className="btn btn-sm">
                Ver leads desta varredura
              </Link>
              <Link to={`/mapa?scanId=${s.id}`} className="btn btn-sm">
                Ver no mapa
              </Link>
              <button type="button" className="btn btn-sm" onClick={() => validate.mutate()} disabled={validate.isPending}>
                Validar WhatsApps agora
              </button>
            </div>
            <h2 className="mb-2 mt-6 font-semibold">Unidades de trabalho (consultas ao coletor)</h2>
            <div className="data-table">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Consulta</th>
                    <th className="text-right">Profundidade</th>
                    <th>Estado</th>
                    <th className="text-right">Locais</th>
                    <th className="text-right">Novos</th>
                    <th>Observação</th>
                  </tr>
                </thead>
                <tbody>
                  {units.map((u) => (
                    <tr key={u.id}>
                      <td>{u.seq}</td>
                      <td className="max-w-72 truncate" title={u.query}>
                        {u.query}
                      </td>
                      <td className="text-right">{u.depth}</td>
                      <td>
                        <UnitStatusBadge status={u.status} />
                      </td>
                      <td className="text-right tabular-nums">{fmtNum(u.placesFound)}</td>
                      <td className="text-right tabular-nums">{fmtNum(u.newRecords)}</td>
                      <td className="max-w-72 truncate text-xs text-base-content/70" title={u.error ?? ''}>
                        {u.error ?? (u.attempts > 1 ? `${u.attempts} tentativas` : '')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-base-content/60">
              Concluir as consultas planejadas não garante que todos os estabelecimentos da região foram encontrados. O coletor não interrompe exatamente no item X; o excedente é salvo e marcado.
            </p>
          </>
        );
      }}
    </QueryState>
  );
}

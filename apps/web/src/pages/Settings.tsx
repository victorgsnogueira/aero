import { useState, type FormEvent } from 'react';
import { NavLink, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../lib/api';
import type { Settings, WaSession } from '../lib/types';
import { Badge, ErrorAlert, Field, Loading, Modal, PageHeader } from '../components/ui';
import { SessionBadge } from '../components/status';
import { useToast } from '../components/toast';
import { fmtDateTime } from '../lib/format';
import { intFromInput } from '../lib/numbers';

const TABS = [
  { key: 'operacao', label: 'Operação' },
  { key: 'whatsapp', label: 'Conexão do WhatsApp' },
  { key: 'diagnostico', label: 'Diagnóstico' },
];

export default function SettingsPage() {
  const { tab = 'operacao' } = useParams();
  return (
    <>
      <PageHeader title="Configurações" />
      <div role="tablist" className="tabs tabs-border mb-6">
        {TABS.map((t) => (
          <NavLink key={t.key} role="tab" to={`/configuracoes/${t.key}`} className={`tab ${tab === t.key ? 'tab-active' : ''}`}>
            {t.label}
          </NavLink>
        ))}
      </div>
      {tab === 'whatsapp' ? <WhatsAppTab /> : tab === 'diagnostico' ? <DiagnosticsTab /> : <OperationTab />}
    </>
  );
}

function OperationTab() {
  const q = useQuery({ queryKey: ['settings'], queryFn: ({ signal }) => api.get<Settings>('/settings', undefined, { signal }) });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />;
  return <OperationForm initial={q.data} />;
}

function OperationForm({ initial }: { initial: Settings }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState(initial);
  const save = useMutation({
    mutationFn: (body: Partial<Settings>) => api.patch<Settings>('/settings', body),
    onSuccess: (data) => {
      qc.setQueryData(['settings'], data);
      setForm(data);
      toast('success', 'Configurações salvas');
    },
    onError: (e) => toast('error', errorMessage(e)),
  });
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setForm((f) => ({ ...f, [k]: v }));
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({
      senderName: form.senderName?.trim() || null,
      companyName: form.companyName?.trim() || null,
      introduction: form.introduction?.trim() || null,
      defaultTimezone: form.defaultTimezone,
      defaultCountry: form.defaultCountry,
      sendMinIntervalSeconds: form.sendMinIntervalSeconds,
      sendDailyLimit: form.sendDailyLimit,
      sendHourlyLimit: form.sendHourlyLimit,
      validationRevalidateDays: form.validationRevalidateDays,
      validationBatchSize: form.validationBatchSize,
      validationMinIntervalMs: form.validationMinIntervalMs,
      scanDefaultDepth: form.scanDefaultDepth,
      scanUnitMaxSeconds: form.scanUnitMaxSeconds,
    });
  };
  const num = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, intFromInput(e.target.value, form[k] as number) as never);

  return (
    <form onSubmit={onSubmit} className="flex max-w-5xl flex-col gap-2">
      {initial.missingForOutreach.length ? (
        <div role="alert" className="alert alert-warning alert-soft">
          Campanhas ficam bloqueadas até preencher: {initial.missingForOutreach.join(', ')}.
        </div>
      ) : null}
      <section className="form-section">
        <div className="form-section-body md:grid-cols-2">
          <h2 className="font-semibold md:col-span-2 text-base">Identificação nas mensagens</h2>
          <Field label="Seu nome (remetente)">{(id) => <input id={id} className="input w-full" value={form.senderName ?? ''} onChange={(e) => set('senderName', e.target.value)} maxLength={120} />}</Field>
          <Field label="Nome da sua empresa">{(id) => <input id={id} className="input w-full" value={form.companyName ?? ''} onChange={(e) => set('companyName', e.target.value)} maxLength={160} />}</Field>
          <Field label="Apresentação (opcional)" className="md:col-span-2" hint="Texto de referência sobre você e seus serviços.">
            {(id) => <textarea id={id} className="textarea w-full" rows={3} value={form.introduction ?? ''} onChange={(e) => set('introduction', e.target.value)} maxLength={2000} />}
          </Field>
          <Field label="Fuso horário padrão" hint="Usado em novas campanhas e nos limites diários (ex.: America/Sao_Paulo).">
            {(id) => <input id={id} className="input w-full" value={form.defaultTimezone} onChange={(e) => set('defaultTimezone', e.target.value)} />}
          </Field>
          <Field label="País padrão (2 letras)" hint="Usado para interpretar telefones sem código de país.">
            {(id) => <input id={id} className="input w-full uppercase" value={form.defaultCountry} onChange={(e) => set('defaultCountry', e.target.value.toUpperCase())} maxLength={2} />}
          </Field>
        </div>
      </section>

      <section className="form-section">
        <div className="form-section-body md:grid-cols-3">
          <div className="md:col-span-3">
            <h2 className="font-semibold text-base">Capacidade do número (compartilhada por todas as campanhas)</h2>
            <p className="text-sm text-base-content/70">Criar mais campanhas não aumenta esses limites. Valores conservadores reduzem riscos, mas não há garantia contra bloqueios do WhatsApp.</p>
          </div>
          <Field label="Intervalo mínimo entre abordagens (s)">{(id) => <input id={id} type="number" min={30} max={3600} className="input w-full" value={form.sendMinIntervalSeconds} onChange={num('sendMinIntervalSeconds')} />}</Field>
          <Field label="Máximo por hora">{(id) => <input id={id} type="number" min={1} max={100} className="input w-full" value={form.sendHourlyLimit} onChange={num('sendHourlyLimit')} />}</Field>
          <Field label="Máximo por dia">{(id) => <input id={id} type="number" min={1} max={500} className="input w-full" value={form.sendDailyLimit} onChange={num('sendDailyLimit')} />}</Field>
        </div>
      </section>

      <section className="form-section">
        <div className="form-section-body md:grid-cols-3">
          <h2 className="font-semibold md:col-span-3 text-base">Validação e coleta</h2>
          <Field label="Revalidar WhatsApp após (dias)">{(id) => <input id={id} type="number" min={1} max={365} className="input w-full" value={form.validationRevalidateDays} onChange={num('validationRevalidateDays')} />}</Field>
          <Field label="Números por consulta">{(id) => <input id={id} type="number" min={1} max={50} className="input w-full" value={form.validationBatchSize} onChange={num('validationBatchSize')} />}</Field>
          <Field label="Pausa entre consultas (ms)">{(id) => <input id={id} type="number" min={1000} max={60000} step={500} className="input w-full" value={form.validationMinIntervalMs} onChange={num('validationMinIntervalMs')} />}</Field>
          <Field label="Profundidade padrão da busca" hint="Rolagens na lista do Google Maps por consulta.">
            {(id) => <input id={id} type="number" min={1} max={100} className="input w-full" value={form.scanDefaultDepth} onChange={num('scanDefaultDepth')} />}
          </Field>
          <Field label="Tempo máximo por consulta (s)" hint="Mínimo de 180 s imposto pelo coletor.">
            {(id) => <input id={id} type="number" min={180} max={3600} className="input w-full" value={form.scanUnitMaxSeconds} onChange={num('scanUnitMaxSeconds')} />}
          </Field>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3 border-t border-base-300 pt-5">
        <button type="submit" className="btn btn-primary" disabled={save.isPending}>
          {save.isPending ? 'Salvando…' : 'Salvar configurações'}
        </button>
        <span className="text-sm text-base-content/70">
          Envio de mensagens: <strong>{initial.sendingEnabled ? 'habilitado' : 'desabilitado'}</strong>
          {initial.sendAllowlistActive ? ' (somente lista de teste)' : ''} — controlado por variável de ambiente.
        </span>
      </div>
    </form>
  );
}

function WhatsAppTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const session = useQuery({ queryKey: ['wa-session'], queryFn: ({ signal }) => api.get<WaSession>('/whatsapp/session', undefined, { signal }), refetchInterval: 10_000 });
  const needsQr = session.data?.status === 'scan_qr' || session.data?.status === 'connecting';
  const qr = useQuery({
    queryKey: ['wa-qr'],
    queryFn: ({ signal }) => api.get<{ image: string | null; reason: string | null }>('/whatsapp/session/qr', undefined, { signal }),
    enabled: needsQr,
    refetchInterval: needsQr ? 15_000 : false,
    gcTime: 0,
  });
  const act = useMutation({
    mutationFn: (action: string) => api.post<WaSession>(action === 'provision' ? '/whatsapp/session/provision' : `/whatsapp/session/${action}`, action === 'logout' ? { confirm: true } : {}),
    onSuccess: (data) => {
      qc.setQueryData(['wa-session'], data);
      void qc.invalidateQueries({ queryKey: ['wa-qr'] });
    },
    onError: (e) => toast('error', errorMessage(e)),
  });

  if (session.isPending) return <Loading />;
  if (session.isError) return <ErrorAlert error={session.error} onRetry={() => void session.refetch()} />;
  const s = session.data;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="form-section">
        <div className="flex flex-col gap-4">
          <h2 className="font-semibold text-base">Sessão do seu número</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-base-content/60">Estado</dt>
            <dd>
              <SessionBadge status={s.status} />
            </dd>
            <dt className="text-base-content/60">Número conectado</dt>
            <dd>{s.ownJid ? s.ownJid.split(/[:@]/)[0] : '—'}</dd>
            <dt className="text-base-content/60">Webhook registrado</dt>
            <dd>{fmtDateTime(s.webhookRegisteredAt)}</dd>
            <dt className="text-base-content/60">Verificado</dt>
            <dd>{fmtDateTime(s.checkedAt)}</dd>
          </dl>
          {s.lastError ? <p className="text-sm text-error">{s.lastError}</p> : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary btn-sm" disabled={act.isPending} onClick={() => act.mutate('provision')}>
              Preparar sessão
            </button>
            <button type="button" className="btn btn-sm" disabled={act.isPending} onClick={() => act.mutate('start')}>
              Conectar
            </button>
            <button type="button" className="btn btn-sm" disabled={act.isPending} onClick={() => act.mutate('restart')}>
              Reconectar
            </button>
            <button type="button" className="btn btn-sm" disabled={act.isPending} onClick={() => act.mutate('stop')}>
              Parar
            </button>
            <button type="button" className="btn btn-error btn-outline btn-sm" disabled={act.isPending} onClick={() => setConfirmLogout(true)}>
              Desvincular aparelho
            </button>
          </div>
          <p className="text-xs text-base-content/60">
            “Preparar sessão” cria a sessão no gateway, desativa o bot embutido dele e registra o webhook do aero. Reinícios normais não exigem novo pareamento: as credenciais ficam persistidas no banco do gateway.
          </p>
        </div>
      </section>
      <section className="form-section">
        <div className="flex flex-col items-center gap-4 text-center">
          <h2 className="font-semibold text-base">Pareamento</h2>
          {s.status === 'connected' ? (
            <p className="text-sm text-base-content/70">Aparelho conectado. Nenhum pareamento necessário.</p>
          ) : needsQr ? (
            qr.data?.image ? (
              <>
                <img src={qr.data.image} alt="QR code para parear o WhatsApp" className="h-64 w-64 rounded-box bg-white p-2" />
                <p className="text-sm text-base-content/70">No celular: WhatsApp › Aparelhos conectados › Conectar um aparelho. O código é renovado periodicamente.</p>
              </>
            ) : (
              <Loading label="Aguardando QR code do gateway…" />
            )
          ) : (
            <p className="text-sm text-base-content/70">Use “Conectar” para iniciar a sessão. O QR code aparece aqui quando o gateway solicitar pareamento.</p>
          )}
        </div>
      </section>
      <Modal
        open={confirmLogout}
        onClose={() => setConfirmLogout(false)}
        title="Desvincular aparelho?"
        actions={
          <>
            <button type="button" className="btn" onClick={() => setConfirmLogout(false)}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn-error"
              onClick={() => {
                setConfirmLogout(false);
                act.mutate('logout');
              }}
            >
              Desvincular
            </button>
          </>
        }
      >
        <p className="text-sm">A sessão será encerrada no WhatsApp e será necessário ler um novo QR code. Envios agendados ficarão parados até reconectar.</p>
      </Modal>
    </div>
  );
}

interface Diag {
  scraper: { ok: boolean; detail: string };
  gateway: { ok: boolean; detail: string };
  webhook: { ok: boolean; detail: string };
  sending: { enabled: boolean; allowlist: number; detail: string };
}

function DiagnosticsTab() {
  const q = useQuery({ queryKey: ['diagnostics'], queryFn: ({ signal }) => api.get<Diag>('/whatsapp/diagnostics', undefined, { signal }) });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorAlert error={q.error} onRetry={() => void q.refetch()} />;
  const rows: [string, { ok: boolean; detail: string }][] = [
    ['Google Maps Scraper', q.data.scraper],
    ['Gateway WhatsApp (WA-AKG)', q.data.gateway],
    ['Webhook gateway → aero', q.data.webhook],
    ['Envio de mensagens', { ok: q.data.sending.enabled, detail: q.data.sending.detail }],
  ];
  return (
    <div className="form-section">
      <div className="flow-root">
        <ul className="divide-y divide-base-300">
          {rows.map(([name, r]) => (
            <li key={name} className="flex items-start justify-between gap-4 py-3">
              <div>
                <p className="font-medium">{name}</p>
                <p className="text-sm text-base-content/70">{r.detail}</p>
              </div>
              <Badge tone={r.ok ? 'success' : 'warning'}>{r.ok ? 'OK' : 'Atenção'}</Badge>
            </li>
          ))}
        </ul>
        <button type="button" className="btn btn-sm mt-2 self-start" onClick={() => void q.refetch()} disabled={q.isFetching}>
          Verificar novamente
        </button>
      </div>
    </div>
  );
}

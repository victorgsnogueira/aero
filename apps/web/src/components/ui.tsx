import { useEffect, useId, useRef, type ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { errorMessage } from '../lib/api';

export function Logo({ size = 28, className = '' }: { size?: number; className?: string }) {
  // Versão preta para fundo claro e branca para fundo escuro (desenho aprovado, sem alterações).
  return (
    <span className={`inline-flex shrink-0 ${className}`} style={{ width: size, height: size }} aria-hidden="true">
      <img src="/brand/tornado-black-256.png" alt="" width={size} height={size} className="brand-light h-full w-full object-contain" />
      <img src="/brand/tornado-white-256.png" alt="" width={size} height={size} className="brand-dark h-full w-full object-contain" />
    </span>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-sm text-base-content/70">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Loading({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-8 text-sm text-base-content/70" role="status">
      <span className="loading loading-spinner loading-sm" aria-hidden="true" />
      {label}
    </div>
  );
}

export function ErrorAlert({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div role="alert" className="alert alert-error alert-soft">
      <span>{errorMessage(error)}</span>
      {onRetry ? (
        <button type="button" className="btn btn-sm" onClick={onRetry}>
          Tentar novamente
        </button>
      ) : null}
    </div>
  );
}

export function QueryState<T>({ query, children, empty }: { query: UseQueryResult<T>; children: (data: T) => ReactNode; empty?: (data: T) => boolean }) {
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorAlert error={query.error} onRetry={() => void query.refetch()} />;
  if (empty && empty(query.data)) return null;
  return <>{children(query.data)}</>;
}

export function EmptyState({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-box border border-dashed border-base-300 px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {description ? <p className="max-w-md text-sm text-base-content/70">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function Field({ label, hint, error, children, className = '' }: { label: string; hint?: ReactNode; error?: string | null; children: (id: string) => ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children(id)}
      {hint ? <p className="text-xs text-base-content/60">{hint}</p> : null}
      {error ? (
        <p className="text-xs text-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return <p className="mt-3 text-xs text-base-content/60">{total} registro(s)</p>;
  return (
    <nav className="mt-4 flex items-center justify-between gap-2" aria-label="Paginação">
      <p className="text-xs text-base-content/60">
        {total} registro(s) · página {page} de {pages}
      </p>
      <div className="join">
        <button type="button" className="btn join-item btn-sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          Anterior
        </button>
        <button type="button" className="btn join-item btn-sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>
          Próxima
        </button>
      </div>
    </nav>
  );
}

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'error' | 'primary' | 'ghost';
const TONE_CLASS: Record<Tone, string> = {
  neutral: 'badge-neutral',
  info: 'badge-info',
  success: 'badge-success',
  warning: 'badge-warning',
  error: 'badge-error',
  primary: 'badge-primary',
  ghost: 'badge-ghost',
};

export function Badge({ tone = 'ghost', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`badge badge-soft badge-sm whitespace-nowrap ${TONE_CLASS[tone]}`} title={title}>
      {children}
    </span>
  );
}

/** Diálogo modal acessível (elemento <dialog> nativo). */
export function Modal({ open, onClose, title, children, actions, wide = false }: { open: boolean; onClose: () => void; title: string; children: ReactNode; actions?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="modal" onClose={onClose} aria-label={title}>
      <div className={`modal-box ${wide ? 'max-w-3xl' : ''}`}>
        <h2 className="mb-4 text-lg font-semibold">{title}</h2>
        {children}
        {actions ? <div className="modal-action">{actions}</div> : null}
      </div>
      <form method="dialog" className="modal-backdrop">
        <button type="submit">Fechar</button>
      </form>
    </dialog>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-box border border-base-300 bg-base-100 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-base-content/60">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-xs text-base-content/60">{hint}</p> : null}
    </div>
  );
}

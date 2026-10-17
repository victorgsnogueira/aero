import { formatMoney } from '@aero/shared';

const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const dateOnly = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' });
const time = new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short' });
const rel = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
const num = new Intl.NumberFormat('pt-BR');
const pct = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 });

export const fmtDateTime = (iso: string | null | undefined) => (iso ? dateTime.format(new Date(iso)) : '—');
export const fmtDate = (iso: string | null | undefined) => (iso ? dateOnly.format(new Date(iso)) : '—');
export const fmtTime = (iso: string | null | undefined) => (iso ? time.format(new Date(iso)) : '');
export const fmtNum = (n: number | null | undefined) => (n === null || n === undefined ? '—' : num.format(n));
export const fmtPct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : pct.format(v));

export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return rel.format(Math.round(diff), 'second');
  if (abs < 3600) return rel.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rel.format(Math.round(diff / 3600), 'hour');
  return rel.format(Math.round(diff / 86400), 'day');
}

/** Exibe valores por moeda sem somar moedas diferentes. */
export function fmtMoneyMap(map: Record<string, number> | null | undefined): string {
  const entries = Object.entries(map ?? {}).filter(([, v]) => v);
  if (!entries.length) return '—';
  return entries.map(([cur, cents]) => formatMoney(cents, cur)).join(' · ');
}

export { formatMoney };

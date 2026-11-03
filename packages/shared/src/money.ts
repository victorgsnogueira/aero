export const CURRENCIES = ['BRL', 'USD', 'EUR'] as const;
export type Currency = (typeof CURRENCIES)[number];

export interface Money {
  amountCents: number;
  currency: string;
}

export function formatMoney(amountCents: number | null | undefined, currency: string, locale = 'pt-BR'): string {
  if (amountCents === null || amountCents === undefined) return '—';
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amountCents / 100);
}

export function parseMoneyToCents(input: string): number | null {
  const cleaned = input.replace(/[^\d,.-]/g, '').trim();
  if (!cleaned) return null;
  const lastSep = Math.max(cleaned.lastIndexOf(','), cleaned.lastIndexOf('.'));
  let intPart = cleaned;
  let fracPart = '';
  if (lastSep >= 0 && cleaned.length - lastSep - 1 <= 2) {
    intPart = cleaned.slice(0, lastSep);
    fracPart = cleaned.slice(lastSep + 1);
  }
  intPart = intPart.replace(/[^\d-]/g, '');
  if (!/^-?\d*$/.test(intPart) || !/^\d{0,2}$/.test(fracPart)) return null;
  const negative = intPart.startsWith('-');
  const digits = (intPart.replace('-', '') || '0') + fracPart.padEnd(2, '0');
  const value = Number.parseInt(digits, 10);
  if (!Number.isSafeInteger(value)) return null;
  return negative ? -value : value;
}

export function sumByCurrency(items: Money[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) out[item.currency] = (out[item.currency] ?? 0) + item.amountCents;
  return out;
}

// Cálculo de janelas de envio em um fuso horário explícito da campanha.
// O relógio/fuso do computador não altera o agendamento: tudo parte de UTC.

export interface SendWindow {
  timezone: string;
  /** Dias permitidos: 0 = domingo ... 6 = sábado. */
  days: number[];
  start: string; // HH:mm
  end: string; // HH:mm
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function localParts(date: Date, timezone: string): LocalParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: WEEKDAYS[parts.weekday as string] ?? 0,
  };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function isWithinWindow(date: Date, w: SendWindow): boolean {
  const p = localParts(date, w.timezone);
  if (!w.days.includes(p.weekday)) return false;
  const minutes = p.hour * 60 + p.minute;
  return minutes >= toMinutes(w.start) && minutes < toMinutes(w.end);
}

/**
 * Próximo instante (UTC) dentro da janela, a partir de `from`.
 * Varre em passos de 1 minuto até o próximo início de janela (máx. 8 dias).
 */
export function nextWindowStart(from: Date, w: SendWindow): Date | null {
  if (isWithinWindow(from, w)) return from;
  const startMin = toMinutes(w.start);
  // Avança até o próximo minuto exato de início, testando cada dia
  let cursor = new Date(Math.ceil(from.getTime() / 60000) * 60000);
  const limit = from.getTime() + 8 * 24 * 3600 * 1000;
  while (cursor.getTime() < limit) {
    const p = localParts(cursor, w.timezone);
    const minutes = p.hour * 60 + p.minute;
    if (w.days.includes(p.weekday) && minutes >= startMin && minutes < toMinutes(w.end)) return cursor;
    // salto: se antes do início no mesmo dia, pula direto até o início
    const jump = minutes < startMin ? startMin - minutes : 24 * 60 - minutes + startMin;
    cursor = new Date(cursor.getTime() + Math.max(1, jump) * 60000);
  }
  return null;
}

/** Início do dia local (00:00) de `date` no fuso, expresso em UTC — usado para limites diários. */
export function startOfLocalDay(date: Date, timezone: string): Date {
  const p = localParts(date, timezone);
  const minutesSinceMidnight = p.hour * 60 + p.minute;
  const approx = new Date(date.getTime() - minutesSinceMidnight * 60000 - date.getUTCSeconds() * 1000 - date.getUTCMilliseconds());
  return approx;
}

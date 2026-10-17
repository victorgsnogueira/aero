import { parsePhoneNumberWithError, validatePhoneNumberLength, type CountryCode } from 'libphonenumber-js/max';
import type { PhoneFormatStatus } from '@aero/shared';

export interface NormalizedPhone {
  raw: string;
  e164: string | null;
  dedupeKey: string;
  countryCode: string | null;
  formatStatus: PhoneFormatStatus;
  note: string | null;
  lineType: string | null;
}

/**
 * Normaliza um telefone considerando o país de contexto (do endereço ou da varredura).
 * Nunca inventa DDI, DDD ou dígitos: números ambíguos ficam como `needs_review`
 * e números sem país identificável não são convertidos para E.164.
 */
export function normalizePhone(rawInput: string, countryHint: string | null | undefined): NormalizedPhone {
  const raw = rawInput.trim();
  const digits = raw.replace(/\D/g, '');
  const hint = countryHint && /^[A-Za-z]{2}$/.test(countryHint) ? (countryHint.toUpperCase() as CountryCode) : undefined;
  const fallbackKey = `raw:${hint ?? 'XX'}:${digits}`;

  const base = { raw, countryCode: hint ?? null, lineType: null } as const;

  if (digits.length < 6) {
    return { ...base, e164: null, dedupeKey: fallbackKey, formatStatus: 'invalid', note: 'Número curto demais' };
  }

  const international = raw.startsWith('+') || raw.startsWith('00');
  if (!international && !hint) {
    return {
      ...base,
      e164: null,
      dedupeKey: fallbackKey,
      formatStatus: 'needs_review',
      note: 'Sem código de país e sem país de contexto',
    };
  }

  const candidate = raw.startsWith('00') ? `+${raw.slice(2)}` : raw;
  try {
    const parsed = parsePhoneNumberWithError(candidate, international ? undefined : hint);
    const country = parsed.country ?? hint ?? null;
    if (parsed.isValid()) {
      return {
        raw,
        e164: parsed.number,
        dedupeKey: parsed.number,
        countryCode: country,
        formatStatus: 'valid',
        note: null,
        lineType: parsed.getType() ?? null,
      };
    }
    const lengthIssue = validatePhoneNumberLength(candidate, international ? undefined : hint);
    if (parsed.isPossible()) {
      return {
        raw,
        e164: null,
        dedupeKey: `raw:${country ?? 'XX'}:${digits}`,
        countryCode: country,
        formatStatus: 'needs_review',
        note: `Formato possível porém não validado (${parsed.number})`,
        lineType: null,
      };
    }
    return {
      raw,
      e164: null,
      dedupeKey: `raw:${country ?? 'XX'}:${digits}`,
      countryCode: country,
      formatStatus: 'invalid',
      note: lengthIssue ? `Comprimento inválido (${lengthIssue})` : 'Número inválido para o país',
      lineType: null,
    };
  } catch (err) {
    return {
      ...base,
      e164: null,
      dedupeKey: fallbackKey,
      formatStatus: 'invalid',
      note: `Não foi possível interpretar: ${(err as Error).message}`,
    };
  }
}

/** JID pessoal do WhatsApp a partir do E.164 (sem '+'). */
export function e164ToJid(e164: string): string {
  return `${e164.replace(/^\+/, '')}@s.whatsapp.net`;
}

/** Extrai o número de um JID pessoal (`5511999999999@s.whatsapp.net`, com ou sem `:device`). */
export function jidToE164(jid: string): string | null {
  const m = /^(\d{6,15})(?::\d+)?@s\.whatsapp\.net$/.exec(jid);
  return m ? `+${m[1]}` : null;
}

export function isLidJid(jid: string): boolean {
  return jid.endsWith('@lid');
}

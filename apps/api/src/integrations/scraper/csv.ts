import { parse } from 'csv-parse/sync';

export interface ScrapedAddress {
  borough: string | null;
  street: string | null;
  city: string | null;
  postalCode: string | null;
  state: string | null;
  country: string | null;
}

export interface ScrapedPlace {
  placeId: string | null;
  cid: string | null;
  dataId: string | null;
  title: string;
  category: string | null;
  address: string | null;
  completeAddress: ScrapedAddress | null;
  phone: string | null;
  website: string | null;
  link: string | null;
  latitude: number | null;
  longitude: number | null;
  rating: number | null;
  reviewCount: number | null;
  timezone: string | null;
  status: string | null;
  raw: Record<string, string>;
}

const EXPECTED = ['title', 'phone', 'latitude', 'longitude', 'place_id'];

function str(v: string | undefined): string | null {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
}

function num(v: string | undefined): number | null {
  const t = str(v);
  if (t === null) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function parseAddress(v: string | undefined): ScrapedAddress | null {
  const t = str(v);
  if (!t) return null;
  try {
    const o = JSON.parse(t) as Record<string, string>;
    return {
      borough: str(o.borough),
      street: str(o.street),
      city: str(o.city),
      postalCode: str(o.postal_code),
      state: str(o.state),
      country: str(o.country),
    };
  } catch {
    return null;
  }
}

export function usableCoordinate(lat: number | null, lng: number | null): boolean {
  if (lat === null || lng === null) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  if (lat === 0 && lng === 0) return false;
  return true;
}

export function parseScraperCsv(csv: string): ScrapedPlace[] {
  if (!csv.trim()) return [];
  const rows = parse(csv, { columns: true, skip_empty_lines: true, relax_column_count: true, bom: true }) as Record<string, string>[];
  if (rows.length > 0) {
    const missing = EXPECTED.filter((c) => !(c in rows[0]!));
    if (missing.length) throw new Error(`CSV do scraper sem colunas esperadas: ${missing.join(', ')}`);
  }
  const out: ScrapedPlace[] = [];
  for (const r of rows) {
    const title = str(r.title);
    if (!title) continue;
    const lat = num(r.latitude);
    const lng = num(r.longitude);
    const coordsOk = usableCoordinate(lat, lng);
    out.push({
      placeId: str(r.place_id),
      cid: str(r.cid),
      dataId: str(r.data_id),
      title,
      category: str(r.category),
      address: str(r.address),
      completeAddress: parseAddress(r.complete_address),
      phone: str(r.phone),
      website: str(r.website),
      link: str(r.link),
      latitude: coordsOk ? lat : null,
      longitude: coordsOk ? lng : null,
      rating: num(r.review_rating),
      reviewCount: num(r.review_count),
      timezone: str(r.timezone),
      status: str(r.status),
      raw: r,
    });
  }
  return out;
}

export function domainFromUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, '').toLowerCase() || null;
  } catch {
    return null;
  }
}

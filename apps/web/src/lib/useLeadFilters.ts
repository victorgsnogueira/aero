import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import type { WaStatus } from '@aero/shared';
import type { LeadFilters } from './types';

/** Filtros da base de leads guardados na URL (compartilhados entre lista e mapa). */
export function useLeadFilters(): [LeadFilters, (patch: Partial<LeadFilters>) => void] {
  const [params, setParams] = useSearchParams();
  const filters = useMemo<LeadFilters>(() => {
    const num = (k: string) => (params.get(k) ? Number(params.get(k)) : undefined);
    const bool = (k: string) => (params.get(k) === null ? undefined : params.get(k) === 'true');
    return {
      q: params.get('q') ?? undefined,
      scanId: num('scanId'),
      campaignId: num('campaignId'),
      category: params.get('category') ?? undefined,
      city: params.get('city') ?? undefined,
      waStatus: (params.get('waStatus') as WaStatus) ?? undefined,
      formatStatus: params.get('formatStatus') ?? undefined,
      hasCoords: bool('hasCoords'),
      suppressed: bool('suppressed'),
      includeDemo: bool('includeDemo'),
    };
  }, [params]);
  const update = useCallback(
    (patch: Partial<LeadFilters>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined || v === null || v === '') next.delete(k);
            else next.set(k, String(v));
          }
          next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  return [filters, update];
}

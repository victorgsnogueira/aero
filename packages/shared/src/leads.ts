export const LEAD_SORT_FIELDS = ['recent', 'name', 'category', 'phone', 'whatsapp', 'local', 'situation'] as const;
export type LeadSortField = (typeof LEAD_SORT_FIELDS)[number];
export type SortDirection = 'asc' | 'desc';

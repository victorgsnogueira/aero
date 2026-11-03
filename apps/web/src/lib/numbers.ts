export function intFromInput(value: string, fallback: number): number {
  if (value.trim() === '') return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

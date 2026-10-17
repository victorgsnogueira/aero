/** Converte o valor de um <input type="number"> em inteiro; vazio ou inválido usa o valor anterior. */
export function intFromInput(value: string, fallback: number): number {
  if (value.trim() === '') return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

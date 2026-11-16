/** Dinheiro: BRL em centavos inteiros. Nenhum cálculo financeiro usa ponto flutuante. */

/** (a * b) / d com arredondamento half-up, em aritmética inteira exata. */
export function mulDivHalfUp(a: number, b: number, d: number): number {
  if (![a, b, d].every(Number.isSafeInteger) || a < 0 || b < 0 || d <= 0) throw new Error('operandos inválidos');
  const n = BigInt(a) * BigInt(b);
  return Number((n * 2n + BigInt(d)) / (2n * BigInt(d)));
}

/** Valor por hora: tarifa (centavos/h) × minutos / 60, half-up em centavos (P05). */
export const hourlyAmount = (rateCents: number, minutes: number) => mulDivHalfUp(rateCents, minutes, 60);

/** Basis points (1% = 100 bps), half-up. */
export const bpsOf = (amountCents: number, bps: number) => mulDivHalfUp(amountCents, bps, 10_000);

/** Multa percentual com teto. */
export const penaltyAmount = (baseCents: number, bps: number, capCents: number) =>
  Math.min(bpsOf(baseCents, bps), capCents);

export function formatBRL(cents: number): string {
  const abs = Math.abs(cents);
  const reais = Math.trunc(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${cents < 0 ? '-' : ''}R$ ${reais},${(abs % 100).toString().padStart(2, '0')}`;
}

/** Converte texto digitado ("120", "120,5", "1.200,50") em centavos, sem float. */
export function parseBRL(input: string): number | null {
  const s = input.trim().replace(/^R\$\s*/i, '').replace(/\./g, '').replace(',', '.');
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

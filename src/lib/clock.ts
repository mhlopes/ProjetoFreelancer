/** Relógio do servidor. Testes podem fixar o instante; produção usa sempre o relógio real. */
let fixed: Date | null = null;

export function now(): Date {
  return fixed ? new Date(fixed.getTime()) : new Date();
}

export function setTestNow(d: Date | null) {
  if (process.env.APP_ENV === 'production') throw new Error('Relógio de teste proibido em produção');
  fixed = d ? new Date(d.getTime()) : null;
}

export const addMinutes = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);
export const addHours = (d: Date, h: number) => addMinutes(d, h * 60);

/** Subtrai meses de calendário (janela móvel de multas). */
export function subMonths(d: Date, months: number): Date {
  const r = new Date(d.getTime());
  const day = r.getUTCDate();
  r.setUTCDate(1);
  r.setUTCMonth(r.getUTCMonth() - months);
  const last = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(day, last));
  return r;
}

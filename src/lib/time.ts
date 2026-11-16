/** Fusos IANA por UF. Simplificação registrada: estados com mais de um fuso usam o da capital. */
const UF_TZ: Record<string, string> = {
  AC: 'America/Rio_Branco', AM: 'America/Manaus', RR: 'America/Boa_Vista', RO: 'America/Porto_Velho',
  MT: 'America/Cuiaba', MS: 'America/Campo_Grande', PA: 'America/Belem', AP: 'America/Belem',
  TO: 'America/Araguaina', MA: 'America/Fortaleza', PI: 'America/Fortaleza', CE: 'America/Fortaleza',
  RN: 'America/Fortaleza', PB: 'America/Fortaleza', PE: 'America/Recife', AL: 'America/Maceio',
  SE: 'America/Maceio', BA: 'America/Bahia', DF: 'America/Sao_Paulo', GO: 'America/Sao_Paulo',
  MG: 'America/Sao_Paulo', ES: 'America/Sao_Paulo', RJ: 'America/Sao_Paulo', SP: 'America/Sao_Paulo',
  PR: 'America/Sao_Paulo', SC: 'America/Sao_Paulo', RS: 'America/Sao_Paulo',
};
export const UFS = Object.keys(UF_TZ).sort();
export const timezoneForUf = (uf: string): string | null => UF_TZ[uf.toUpperCase()] ?? null;

function tzOffsetMinutes(utc: Date, tz: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
    }).formatToParts(utc).map((x) => [x.type, x.value]),
  );
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - utc.getTime()) / 60_000);
}

/** Interpreta "YYYY-MM-DDTHH:mm" como horário local do fuso do serviço. */
export function zonedToUtc(local: string, tz: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  if (Number.isNaN(guess)) return null;
  return new Date(guess - tzOffsetMinutes(new Date(guess), tz) * 60_000);
}

export function formatDateTime(d: Date | string | null | undefined, tz = 'America/Sao_Paulo'): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: tz, dateStyle: 'short', timeStyle: 'short' }).format(new Date(d));
}

export function formatDuration(minutes: number): string {
  const h = Math.trunc(minutes / 60), m = minutes % 60;
  return h && m ? `${h}h${String(m).padStart(2, '0')}` : h ? `${h}h` : `${m}min`;
}

/** Distância em km (haversine). Uso geográfico, nunca financeiro. */
export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = Math.PI / 180, R = 6371;
  const dLat = (bLat - aLat) * r, dLng = (bLng - aLng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

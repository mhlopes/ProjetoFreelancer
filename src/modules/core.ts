import { q, q1 } from '@/lib/db';
import { now } from '@/lib/clock';
import { config, feeBps } from '@/lib/config';
import { tooMany } from '@/lib/errors';

/** Usuário autenticado que executa a operação. Autorização é sempre verificada nos serviços. */
export type Actor = { id: string; isSupport: boolean };

export type Policy = {
  version: number;
  requestExpiryHours: number;
  completionConfirmationHours: number;
  penaltyReviewCount: number;
  penaltyLookbackCalendarMonths: number;
  scheduledFreeCancellationBeforeHours: number;
  scheduledBookingGraceMinutes: number;
  noShowWaitMinutes: number;
  cancellationPenaltyBps: number;
  cancellationCapCents: number;
  noShowPenaltyBps: number;
  noShowCapCents: number;
  fundingReservationMinutes: number;
  matchingBatchSize: number;
  matchingBatchIntervalSeconds: number;
  matchingInitialRadiusKm: number;
  /** Comissão vigente no momento do snapshot (O01). */
  platformFeeBps: number;
};

/** Política vigente (última versão). Contratos guardam um snapshot e nunca recalculam com regra posterior. */
export async function currentPolicy(): Promise<Policy> {
  const row = await q1<{ version: number; params: Omit<Policy, 'version' | 'platformFeeBps'> }>(
    'SELECT version, params FROM policy_versions ORDER BY version DESC LIMIT 1',
  );
  if (!row) throw new Error('Nenhuma política cadastrada');
  return { ...row.params, version: row.version, platformFeeBps: feeBps() };
}

export async function audit(
  actorId: string | null,
  action: string,
  resourceType: string,
  resourceId: string,
  reason: string | null = null,
  data: Record<string, unknown> = {},
) {
  await q(
    'INSERT INTO audit_events (actor_id, action, resource_type, resource_id, reason, data, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [actorId, action, resourceType, resourceId, reason, JSON.stringify(data), now()],
  );
}

/** Notificação na caixa interna. dedupeKey evita alertas repetidos; conteúdo sem dados sensíveis. */
export async function notify(userId: string, kind: string, title: string, body: string, link: string | null, dedupeKey: string) {
  await q(
    `INSERT INTO notifications (user_id, kind, title, body, link, dedupe_key, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (dedupe_key) DO NOTHING`,
    [userId, kind, title, body, link, dedupeKey, now()],
  );
}

/** Limite simples por janela fixa, persistido no banco. */
export async function rateLimit(scope: string, key: string, max: number, windowSeconds: number) {
  const t = now().getTime();
  const windowStart = new Date(t - (t % (windowSeconds * 1000)));
  const row = await q1<{ count: number }>(
    `INSERT INTO rate_limits (scope, key, window_start, count) VALUES ($1,$2,$3,1)
     ON CONFLICT (scope, key, window_start) DO UPDATE SET count = rate_limits.count + 1 RETURNING count`,
    [scope, key, windowStart],
  );
  if (row && row.count > max) throw tooMany();
}

export function featureEnabled(flag: string | null): boolean {
  return flag == null || config.features[flag] === true;
}

export async function isBlockedBetween(a: string, b: string): Promise<boolean> {
  const r = await q1(
    'SELECT 1 FROM blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1) LIMIT 1',
    [a, b],
  );
  return !!r;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === 'string' && UUID_RE.test(s);

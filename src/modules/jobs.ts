import { expireFundingHolds } from './contracts';
import { deliverDelayedMockEvents, retryProviderEvents } from './payments';
import { advanceMatching, expireDueRequests } from './requests';
import { releaseDueUnits, remindDeadlines } from './settlement';
import { dispatchPendingPayouts } from './wallet';

/**
 * Varreduras idempotentes derivadas do estado no banco: se o processo ficar fora do ar, a próxima execução
 * recupera tudo sem alterar prazos originais (cada handler revalida estado e relógio sob trava).
 */
const JOBS: [string, () => Promise<number>][] = [
  ['expireFundingHolds', () => expireFundingHolds()],
  ['expireDueRequests', expireDueRequests],
  ['advanceMatching', advanceMatching],
  ['deliverDelayedMockEvents', deliverDelayedMockEvents],
  ['retryProviderEvents', retryProviderEvents],
  ['releaseDueUnits', releaseDueUnits],
  ['remindDeadlines', remindDeadlines],
  ['dispatchPendingPayouts', dispatchPendingPayouts],
];

export async function runDueJobs(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const [name, fn] of JOBS) {
    try {
      out[name] = await fn();
    } catch (e) {
      out[name] = -1;
      console.error(`[jobs] ${name} falhou`, e);
    }
  }
  return out;
}

const g = globalThis as unknown as { __jobsTimer?: ReturnType<typeof setInterval>; __jobsRunning?: boolean };

/** Worker em processo (desenvolvimento local, banco embarcado). Em produção deve ser um processo separado. */
export function startJobLoop(intervalMs = 15_000) {
  if (g.__jobsTimer) return;
  g.__jobsTimer = setInterval(async () => {
    if (g.__jobsRunning) return;
    g.__jobsRunning = true;
    try {
      await runDueJobs();
    } finally {
      g.__jobsRunning = false;
    }
  }, intervalMs);
  g.__jobsTimer.unref?.();
}

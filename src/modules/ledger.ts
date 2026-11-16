import { q, q1, tx } from '@/lib/db';
import { now } from '@/lib/clock';
import { rule } from '@/lib/errors';

/**
 * Ledger append-only com partidas balanceadas em centavos (docs/04-pagamentos.md).
 * Cada lançamento é assinado: >0 credita a conta, <0 debita. A soma de cada transação é zero (verificado aqui e
 * por trigger no banco). O saldo exibido é derivado dos lançamentos; nunca é editado manualmente.
 *
 * Contas:
 *  provider_clearing  — contrapartida do dinheiro recebido pelo provedor (fica negativa conforme entram fundos)
 *  client_wallet      — crédito do contratante (reembolsos); usável para pagar serviços
 *  unit_reserve       — valor retido por unidade de pagamento
 *  worker_earnings    — saldo liberado do trabalhador, disponível para saque
 *  payout_transit     — saque solicitado, em trânsito
 *  provider_payout    — saques concluídos pelo provedor
 *  fee_revenue        — comissão da plataforma
 *  penalty_debt       — dívida de multa do usuário (negativa = deve); separada do saldo sacável
 *  penalty_receivable — contrapartida das multas a receber
 *  reconciliation     — valores recebidos sem destino (ex.: pagamento após reserva expirada)
 */
export type AccountKind =
  | 'provider_clearing' | 'client_wallet' | 'unit_reserve' | 'worker_earnings' | 'payout_transit'
  | 'provider_payout' | 'fee_revenue' | 'penalty_debt' | 'penalty_receivable' | 'reconciliation';

const ALLOW_NEGATIVE: ReadonlySet<AccountKind> = new Set(['provider_clearing', 'penalty_debt']);

export async function account(kind: AccountKind, owner: { userId?: string; unitId?: string } = {}): Promise<string> {
  const userId = owner.userId ?? null, unitId = owner.unitId ?? null;
  const find = () => q1<{ id: string }>(
    `SELECT id FROM ledger_accounts WHERE kind = $1 AND user_id IS NOT DISTINCT FROM $2::uuid AND unit_id IS NOT DISTINCT FROM $3::uuid`,
    [kind, userId, unitId],
  );
  const existing = await find();
  if (existing) return existing.id;
  await q(
    `INSERT INTO ledger_accounts (kind, user_id, unit_id, allow_negative) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
    [kind, userId, unitId, ALLOW_NEGATIVE.has(kind)],
  );
  return (await find())!.id;
}

export async function balanceOf(kind: AccountKind, owner: { userId?: string; unitId?: string } = {}): Promise<number> {
  const r = await q1<{ balance_cents: number }>(
    `SELECT balance_cents FROM ledger_accounts WHERE kind = $1 AND user_id IS NOT DISTINCT FROM $2::uuid AND unit_id IS NOT DISTINCT FROM $3::uuid`,
    [kind, owner.userId ?? null, owner.unitId ?? null],
  );
  return r?.balance_cents ?? 0;
}

export type Leg = { account: string; amount: number };

/**
 * Registra uma transação. Idempotente pela chave: repetir a mesma chave não cria novo lançamento.
 * Trava as contas em ordem estável e recusa saldo negativo onde não é permitido.
 */
export async function post(t: {
  kind: string; key: string; refType: string; refId: string; memo?: string; reversesTxId?: string; legs: Leg[];
}): Promise<{ txId: string; created: boolean }> {
  return tx(async () => {
    const merged = new Map<string, number>();
    for (const l of t.legs) {
      if (!Number.isSafeInteger(l.amount)) throw new Error('valor de ledger deve ser inteiro de centavos');
      merged.set(l.account, (merged.get(l.account) ?? 0) + l.amount);
    }
    const legs = [...merged].filter(([, a]) => a !== 0);
    if (legs.reduce((s, [, a]) => s + a, 0) !== 0) throw new Error(`transação de ledger desbalanceada (${t.key})`);

    const ins = await q1<{ id: string }>(
      `INSERT INTO ledger_transactions (kind, idempotency_key, reference_type, reference_id, reverses_tx_id, memo, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
      [t.kind, t.key, t.refType, t.refId, t.reversesTxId ?? null, t.memo ?? '', now()],
    );
    if (!ins) {
      const prev = await q1<{ id: string }>('SELECT id FROM ledger_transactions WHERE idempotency_key = $1', [t.key]);
      return { txId: prev!.id, created: false };
    }
    for (const [accountId, amount] of legs.sort(([a], [b]) => (a < b ? -1 : 1))) {
      const acc = await q1<{ balance_cents: number; allow_negative: boolean }>(
        'SELECT balance_cents, allow_negative FROM ledger_accounts WHERE id = $1 FOR UPDATE', [accountId],
      );
      if (!acc) throw new Error('conta de ledger inexistente');
      if (!acc.allow_negative && acc.balance_cents + amount < 0) throw rule('insufficient_funds', 'Saldo insuficiente.');
      await q('INSERT INTO ledger_entries (tx_id, account_id, amount_cents, created_at) VALUES ($1,$2,$3,$4)', [ins.id, accountId, amount, now()]);
    }
    return { txId: ins.id, created: true };
  });
}

export async function findTx(key: string): Promise<string | null> {
  return (await q1<{ id: string }>('SELECT id FROM ledger_transactions WHERE idempotency_key = $1', [key]))?.id ?? null;
}

/** Conciliação interna: lançamentos somam zero, cada transação balanceia e o cache bate com os lançamentos. */
export async function ledgerHealth() {
  const total = await q1<{ s: number }>('SELECT COALESCE(sum(amount_cents),0)::bigint AS s FROM ledger_entries');
  const unbalanced = await q<{ tx_id: string }>('SELECT tx_id FROM ledger_entries GROUP BY tx_id HAVING sum(amount_cents) <> 0');
  const drift = await q<{ id: string; kind: string }>(
    `SELECT a.id, a.kind FROM ledger_accounts a
      WHERE a.balance_cents <> (SELECT COALESCE(sum(e.amount_cents),0) FROM ledger_entries e WHERE e.account_id = a.id)`,
  );
  const negative = await q<{ id: string; kind: string }>('SELECT id, kind FROM ledger_accounts WHERE NOT allow_negative AND balance_cents < 0');
  const byKind = await q<{ kind: string; total: number }>(
    'SELECT kind, sum(balance_cents)::bigint AS total FROM ledger_accounts GROUP BY kind ORDER BY kind',
  );
  return {
    totalCents: Number(total!.s),
    unbalancedTransactions: unbalanced.length,
    cacheDrift: drift.length,
    negativeAccounts: negative.length,
    byKind: byKind.map((b) => ({ kind: b.kind, total: Number(b.total) })),
    ok: Number(total!.s) === 0 && !unbalanced.length && !drift.length && !negative.length,
  };
}

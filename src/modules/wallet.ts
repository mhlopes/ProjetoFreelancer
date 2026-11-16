import { q, q1, tx } from '@/lib/db';
import { now } from '@/lib/clock';
import { conflict, invalid, rule } from '@/lib/errors';
import { notify, type Actor } from './core';
import { getGateway } from './gateway';
import { requireEligibleWorker } from './identity';
import { account, balanceOf, post } from './ledger';

export type WalletSummary = {
  /** Ganhos liberados, disponíveis para saque. */
  availableCents: number;
  /** Crédito de reembolsos, utilizável para pagar serviços. */
  creditCents: number;
  /** Retido em serviços que você contratou. */
  heldAsClientCents: number;
  /** Retido em serviços que você está executando (a liberar). */
  heldForWorkerCents: number;
  /** Saques em trânsito. */
  inPayoutCents: number;
  /** Dívida de multas: conta separada, nunca abatida silenciosamente do saldo. */
  debtCents: number;
};

/** Todos os valores derivam do ledger. */
export async function getWallet(actor: Actor): Promise<WalletSummary> {
  const held = async (col: 'client_id' | 'worker_id') =>
    Number((await q1<{ s: number }>(
      `SELECT COALESCE(sum(a.balance_cents),0)::bigint AS s FROM ledger_accounts a
         JOIN work_units u ON u.id = a.unit_id JOIN contracts k ON k.id = u.contract_id
        WHERE a.kind = 'unit_reserve' AND k.${col} = $1`, [actor.id],
    ))!.s);
  return {
    availableCents: await balanceOf('worker_earnings', { userId: actor.id }),
    creditCents: await balanceOf('client_wallet', { userId: actor.id }),
    heldAsClientCents: await held('client_id'),
    heldForWorkerCents: await held('worker_id'),
    inPayoutCents: await balanceOf('payout_transit', { userId: actor.id }),
    debtCents: Math.max(0, -(await balanceOf('penalty_debt', { userId: actor.id }))),
  };
}

export type WalletEntry = { id: number; amount_cents: number; account_kind: string; tx_kind: string; memo: string; created_at: Date; service_title: string | null };

/** Extrato do próprio usuário, legível por serviço. */
export async function listWalletEntries(actor: Actor, limit = 100): Promise<WalletEntry[]> {
  return q<WalletEntry>(
    `SELECT e.id, e.amount_cents, a.kind AS account_kind, t.kind AS tx_kind, t.memo, e.created_at,
            (SELECT r.title FROM work_units u JOIN contracts k ON k.id = u.contract_id JOIN service_requests r ON r.id = k.request_id
              WHERE (t.reference_type = 'unit' AND u.id::text = t.reference_id) OR (t.reference_type = 'contract' AND k.id::text = t.reference_id) LIMIT 1) AS service_title
       FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id JOIN ledger_transactions t ON t.id = e.tx_id
      WHERE a.user_id = $1 ORDER BY e.id DESC LIMIT $2`,
    [actor.id, Math.min(Math.max(limit, 1), 200)],
  );
}

export type Payout = { id: string; user_id: string; amount_cents: number; status: 'pending' | 'processing' | 'paid' | 'failed'; provider_ref: string | null; created_at: Date };

export const listPayouts = (actor: Actor) =>
  q<Payout>('SELECT id, user_id, amount_cents, status, provider_ref, created_at FROM payouts WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50', [actor.id]);

/**
 * Saque solicitado pelo trabalhador (R19). Idempotente pela chave: repetir a mesma chave devolve o mesmo saque,
 * sem novo débito; a mesma chave com outro valor é conflito. O saldo disponível nunca fica negativo (trava da
 * conta + CHECK no banco). Dívida de multa é conta separada e não cria saldo sacável.
 */
export async function requestPayout(actor: Actor, input: { amountCents: number; idempotencyKey: string }): Promise<Payout> {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) throw invalid('Informe um valor de saque válido.');
  if (!input.idempotencyKey || input.idempotencyKey.length > 200) throw invalid('Idempotency-Key obrigatória.');
  await requireEligibleWorker(actor.id);
  const payout = await tx(async () => {
    const earnings = await account('worker_earnings', { userId: actor.id });
    await q1('SELECT 1 FROM ledger_accounts WHERE id = $1 FOR UPDATE', [earnings]); // serializa saques do mesmo usuário
    const prev = await q1<Payout>('SELECT id, user_id, amount_cents, status, provider_ref, created_at FROM payouts WHERE user_id=$1 AND idempotency_key=$2', [actor.id, input.idempotencyKey]);
    if (prev) {
      if (prev.amount_cents !== input.amountCents) throw conflict('idempotency_mismatch', 'Esta chave de idempotência já foi usada com outro valor.');
      return prev;
    }
    const balance = await balanceOf('worker_earnings', { userId: actor.id });
    if (balance < input.amountCents) throw rule('insufficient_funds', 'Saldo disponível insuficiente para este saque.');
    const p = await q1<Payout>(
      `INSERT INTO payouts (user_id, amount_cents, idempotency_key, created_at, updated_at) VALUES ($1,$2,$3,$4,$4)
       RETURNING id, user_id, amount_cents, status, provider_ref, created_at`,
      [actor.id, input.amountCents, input.idempotencyKey, now()],
    );
    await post({
      kind: 'payout_hold', key: `payout_hold:${p!.id}`, refType: 'payout', refId: p!.id, memo: 'Saque solicitado',
      legs: [
        { account: earnings, amount: -input.amountCents },
        { account: await account('payout_transit', { userId: actor.id }), amount: input.amountCents },
      ],
    });
    return p!;
  });
  // O provedor é chamado fora da transação; se falhar aqui, o job reenvia os saques pendentes.
  await dispatchPayout(payout.id).catch((e) => console.error('[payout] envio ao provedor falhou; será reenviado', payout.id, e));
  return (await q1<Payout>('SELECT id, user_id, amount_cents, status, provider_ref, created_at FROM payouts WHERE id=$1', [payout.id]))!;
}

async function dispatchPayout(payoutId: string) {
  const p = await q1<Payout>(`SELECT * FROM payouts WHERE id=$1 AND status='pending'`, [payoutId]);
  if (!p) return;
  const gw = getGateway();
  const { providerRef } = await gw.requestPayout({ amountCents: p.amount_cents, reference: p.id });
  await q(`UPDATE payouts SET status='processing', provider=$2, provider_ref=$3, updated_at=$4 WHERE id=$1 AND status='pending'`, [p.id, gw.name, providerRef, now()]);
}

/** Job: reenvia ao provedor saques que ficaram pendentes. */
export async function dispatchPendingPayouts(): Promise<number> {
  const rows = await q<{ id: string }>(`SELECT id FROM payouts WHERE status='pending' ORDER BY created_at LIMIT 50`);
  for (const r of rows) await dispatchPayout(r.id).catch((e) => console.error('[payout] reenvio falhou', r.id, e));
  return rows.length;
}

/**
 * Resultado do saque informado pelo provedor (via webhook validado). Sucesso finaliza na conta de saída;
 * falha devolve o valor ao saldo disponível UMA única vez. Chamado sob transação.
 */
export async function settlePayout(providerRef: string, amountCents: number, outcome: 'paid' | 'failed') {
  const p = await q1<Payout>('SELECT * FROM payouts WHERE provider_ref = $1 FOR UPDATE', [providerRef]);
  if (!p) throw new Error(`saque desconhecido para ${providerRef}`);
  if (p.amount_cents !== amountCents) throw new Error('valor do saque diverge do informado pelo provedor');
  if (p.status === 'paid' || p.status === 'failed') return; // já finalizado: evento repetido não tem efeito
  const transit = await account('payout_transit', { userId: p.user_id });
  await post({
    kind: `payout_${outcome}`, key: `payout_final:${p.id}`, refType: 'payout', refId: p.id, memo: outcome === 'paid' ? 'Saque pago' : 'Saque falhou: valor devolvido',
    legs: [
      { account: transit, amount: -p.amount_cents },
      { account: outcome === 'paid' ? await account('provider_payout') : await account('worker_earnings', { userId: p.user_id }), amount: p.amount_cents },
    ],
  });
  await q('UPDATE payouts SET status=$2, updated_at=$3 WHERE id=$1', [p.id, outcome, now()]);
  await notify(p.user_id, `payout.${outcome}`, outcome === 'paid' ? 'Saque concluído' : 'Saque não concluído',
    outcome === 'paid' ? 'Seu saque foi pago.' : 'O saque falhou e o valor voltou ao seu saldo disponível.', '/carteira', `payout.${outcome}:${p.id}`);
}

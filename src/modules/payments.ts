import { q, q1, tx } from '@/lib/db';
import { now } from '@/lib/clock';
import { conflict, forbidden, invalid, notFound } from '@/lib/errors';
import { audit, isUuid, notify, type Actor } from './core';
import { confirmFunding, expireFundingHolds, type Contract, type WorkUnit } from './contracts';
import { getGateway, getMockGateway, type MockScenario, type ProviderEvent } from './gateway';
import { account, post } from './ledger';
import { settlePayout } from './wallet';

export type Payment = {
  id: string; unit_id: string; contract_id: string; payer_id: string; method: 'pix' | 'card'; amount_cents: number;
  provider: string; provider_ref: string; status: 'pending' | 'confirmed' | 'failed' | 'late_reconciled'; created_at: Date;
};

/**
 * Inicia a cobrança de um contrato aguardando pagamento. O valor é SEMPRE derivado do acordo no servidor;
 * nada vindo do navegador define quanto cobrar. Criar a cobrança não confirma nada: a confirmação só vem por
 * evento validado do provedor. Idempotente: reaproveita cobrança pendente do mesmo método.
 */
export async function createContractPayment(actor: Actor, contractId: string, input: { method: string }): Promise<Payment> {
  if (!isUuid(contractId)) throw notFound();
  if (input.method !== 'pix' && input.method !== 'card') throw invalid('Método de pagamento inválido.');
  await expireFundingHolds({});
  return tx(async () => {
    const c = await q1<Contract>('SELECT * FROM contracts WHERE id = $1 FOR UPDATE', [contractId]);
    if (!c || (c.client_id !== actor.id && c.worker_id !== actor.id)) throw notFound();
    if (c.client_id !== actor.id) throw forbidden('Somente o contratante paga o contrato.');
    if (c.status !== 'awaiting_funding') throw conflict('bad_state', c.status === 'cancelled' ? 'A reserva expirou. Aprove o profissional novamente.' : 'Este contrato não está aguardando pagamento.');
    const unit = (await q1<WorkUnit>(`SELECT * FROM work_units WHERE contract_id=$1 AND status='awaiting_funding' ORDER BY seq LIMIT 1 FOR UPDATE`, [c.id]))!;
    const existing = await q1<Payment>(`SELECT * FROM payments WHERE unit_id=$1 AND method=$2 AND status='pending'`, [unit.id, input.method]);
    if (existing) return existing;
    const gw = getGateway();
    // Dados de cartão nunca passam pelo backend: o provedor real fará a tokenização no próprio componente.
    const { providerRef } = await gw.createPayment({ amountCents: unit.budget_cents, method: input.method as 'pix' | 'card', reference: unit.id });
    const p = await q1<Payment>(
      `INSERT INTO payments (unit_id, contract_id, payer_id, method, amount_cents, provider, provider_ref, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [unit.id, c.id, actor.id, input.method, unit.budget_cents, gw.name, providerRef, now()],
    );
    return p!;
  });
}

export async function getPaymentForPayer(actor: Actor, paymentId: string) {
  if (!isUuid(paymentId)) throw notFound();
  const p = await q1<Payment & { title: string; hold_expires_at: Date | null }>(
    `SELECT p.*, r.title, (SELECT expires_at FROM schedule_reservations s WHERE s.contract_id = p.contract_id AND s.state='held') AS hold_expires_at
       FROM payments p JOIN contracts k ON k.id = p.contract_id JOIN service_requests r ON r.id = k.request_id WHERE p.id = $1`, [paymentId],
  );
  if (!p || p.payer_id !== actor.id) throw notFound();
  return p;
}

/**
 * Entrada de webhook. Valida a assinatura sobre o corpo bruto, grava o evento (único por provedor+id) e processa.
 * Evento repetido não tem efeito. Falha de processamento fica registrada para nova tentativa pelo job.
 */
export async function handleWebhook(provider: string, rawBody: string, signature: string | null): Promise<{ status: 'processed' | 'duplicate' | 'failed' }> {
  const gw = getGateway();
  if (provider !== gw.name) throw notFound();
  const event = gw.verifyWebhook(rawBody, signature);
  const ins = await q1<{ id: string }>(
    `INSERT INTO provider_events (provider, event_id, type, payload, received_at) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (provider, event_id) DO NOTHING RETURNING id`,
    [provider, event.id, event.type, JSON.stringify(event), now()],
  );
  if (!ins) {
    const prev = await q1<{ id: string; status: string }>('SELECT id, status FROM provider_events WHERE provider=$1 AND event_id=$2', [provider, event.id]);
    if (prev!.status === 'processed') return { status: 'duplicate' };
    return processEvent(prev!.id);
  }
  return processEvent(ins.id);
}

async function processEvent(eventRowId: string): Promise<{ status: 'processed' | 'duplicate' | 'failed' }> {
  try {
    return await tx(async () => {
      const row = await q1<{ id: string; status: string; payload: ProviderEvent }>('SELECT id, status, payload FROM provider_events WHERE id = $1 FOR UPDATE', [eventRowId]);
      if (!row) throw new Error('evento inexistente');
      if (row.status === 'processed') return { status: 'duplicate' as const };
      const e = row.payload;
      if (e.data.currency !== 'BRL') throw new Error('moeda inesperada');
      if (e.type === 'payment.confirmed') await applyPaymentConfirmed(e);
      else if (e.type === 'payment.failed') await applyPaymentFailed(e);
      else if (e.type === 'payout.paid') await settlePayout(e.data.providerRef, e.data.amountCents, 'paid');
      else if (e.type === 'payout.failed') await settlePayout(e.data.providerRef, e.data.amountCents, 'failed');
      else throw new Error(`tipo de evento desconhecido: ${String((e as { type: string }).type)}`);
      await q(`UPDATE provider_events SET status='processed', processed_at=$2, attempts=attempts+1, error=NULL WHERE id=$1`, [row.id, now()]);
      return { status: 'processed' as const };
    });
  } catch (err) {
    // a transação foi desfeita; registra a falha para retry e análise (fila de falhas)
    await q(`UPDATE provider_events SET status='failed', attempts=attempts+1, error=$2 WHERE id=$1 AND status <> 'processed'`, [
      eventRowId, String((err as Error).message ?? err).slice(0, 500),
    ]);
    console.error('[webhook] falha ao processar evento', eventRowId, (err as Error).message);
    return { status: 'failed' };
  }
}

async function applyPaymentConfirmed(e: ProviderEvent) {
  const p = await q1<Payment>('SELECT * FROM payments WHERE provider_ref = $1 FOR UPDATE', [e.data.providerRef]);
  if (!p) throw new Error(`pagamento desconhecido para ${e.data.providerRef}`);
  // conferência de valor: o evento precisa bater com a cobrança criada
  if (p.amount_cents !== e.data.amountCents) throw new Error('valor confirmado diverge da cobrança');
  if (p.status === 'confirmed' || p.status === 'late_reconciled') return; // outro evento já confirmou
  const t = now();
  const c = (await q1<Contract>('SELECT * FROM contracts WHERE id = $1 FOR UPDATE', [p.contract_id]))!;
  const unit = (await q1<WorkUnit>('SELECT * FROM work_units WHERE id = $1 FOR UPDATE', [p.unit_id]))!;
  const hold = await q1<{ expires_at: Date }>(`SELECT expires_at FROM schedule_reservations WHERE contract_id=$1 AND state='held' FOR UPDATE`, [c.id]);
  const clearing = await account('provider_clearing');

  if (c.status === 'awaiting_funding' && unit.status === 'awaiting_funding' && hold && hold.expires_at > t) {
    await post({
      kind: 'payment', key: `payment:${p.id}`, refType: 'unit', refId: unit.id, memo: `Pagamento ${p.method} confirmado`,
      legs: [
        { account: clearing, amount: -p.amount_cents },
        { account: await account('unit_reserve', { unitId: unit.id }), amount: p.amount_cents },
      ],
    });
    await q(`UPDATE payments SET status='confirmed', confirmed_at=$2 WHERE id=$1`, [p.id, t]);
    await q(`UPDATE payments SET status='failed' WHERE unit_id=$1 AND status='pending' AND id <> $2`, [unit.id, p.id]);
    await confirmFunding(c.id, unit.id, p.amount_cents);
    return;
  }

  // Pagamento tardio (reserva expirada, contrato cancelado ou já financiado): NÃO recupera vaga nem cria contrato.
  // O valor entra em conciliação e é devolvido conforme a política atual (crédito em carteira — pendência O03).
  const recon = await account('reconciliation');
  await post({
    kind: 'payment_late', key: `payment:${p.id}`, refType: 'payment', refId: p.id, memo: 'Pagamento recebido sem reserva válida',
    legs: [{ account: clearing, amount: -p.amount_cents }, { account: recon, amount: p.amount_cents }],
  });
  await post({
    kind: 'refund_wallet', key: `refund:payment:${p.id}`, refType: 'payment', refId: p.id, memo: 'Devolução de pagamento tardio em crédito de carteira',
    legs: [{ account: recon, amount: -p.amount_cents }, { account: await account('client_wallet', { userId: p.payer_id }), amount: p.amount_cents }],
  });
  await q(
    `INSERT INTO refunds (payment_id, unit_id, user_id, amount_cents, destination, reason, idempotency_key, created_at)
     VALUES ($1,$2,$3,$4,'wallet','Pagamento confirmado após expiração da reserva',$5,$6) ON CONFLICT (idempotency_key) DO NOTHING`,
    [p.id, unit.id, p.payer_id, p.amount_cents, `refund:payment:${p.id}`, t],
  );
  await q(`UPDATE payments SET status='late_reconciled', confirmed_at=$2 WHERE id=$1`, [p.id, t]);
  await audit(null, 'payment.late_reconciled', 'payment', p.id, 'Pagamento confirmado sem reserva válida; devolvido em carteira', { amountCents: p.amount_cents });
  await notify(p.payer_id, 'payment.late', 'Pagamento recebido após o prazo',
    'A reserva já havia expirado. O valor foi devolvido como crédito na sua carteira.', '/carteira', `payment.late:${p.id}`);
}

async function applyPaymentFailed(e: ProviderEvent) {
  const p = await q1<Payment>('SELECT * FROM payments WHERE provider_ref = $1 FOR UPDATE', [e.data.providerRef]);
  if (!p) throw new Error(`pagamento desconhecido para ${e.data.providerRef}`);
  if (p.status !== 'pending') return;
  await q(`UPDATE payments SET status='failed' WHERE id=$1`, [p.id]);
  await notify(p.payer_id, 'payment.failed', 'Pagamento não aprovado', 'Tente novamente enquanto a reserva estiver válida.', `/contratos/${p.contract_id}`, `payment.failed:${p.id}`);
}

/** Job: reprocessa eventos recebidos que falharam (até 5 tentativas; depois ficam na fila de falhas do suporte). */
export async function retryProviderEvents(): Promise<number> {
  const rows = await q<{ id: string }>(`SELECT id FROM provider_events WHERE status IN ('received','failed') AND attempts < 5 ORDER BY received_at LIMIT 50`);
  for (const r of rows) await processEvent(r.id);
  return rows.length;
}

// ───────────── Provedor SIMULADO (somente desenvolvimento/teste) ─────────────

/** O pagador escolhe o desfecho da cobrança simulada. Entrega o evento assinado pelo mesmo caminho do webhook. */
export async function simulatePaymentOutcome(actor: Actor, paymentId: string, scenario: MockScenario) {
  const p = await getPaymentForPayer(actor, paymentId);
  const gw = getMockGateway();
  for (const env of await gw.simulate(p.provider_ref, scenario)) await handleWebhook(gw.name, env.rawBody, env.signature);
}

/** Console do provedor simulado (suporte): resolve saques e entrega eventos atrasados. */
export async function simulateProviderObject(actor: Actor, ref: string, scenario: MockScenario) {
  if (!actor.isSupport) throw forbidden();
  const gw = getMockGateway();
  for (const env of await gw.simulate(ref, scenario)) await handleWebhook(gw.name, env.rawBody, env.signature);
}

export async function deliverDelayedMockEvents(): Promise<number> {
  let gw;
  try { gw = getMockGateway(); } catch { return 0; }
  const envs = await gw.dueDelayedEvents();
  for (const env of envs) await handleWebhook(gw.name, env.rawBody, env.signature);
  return envs.length;
}

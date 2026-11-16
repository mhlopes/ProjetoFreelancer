import { q, q1, tx } from '@/lib/db';
import { now } from '@/lib/clock';
import { config } from '@/lib/config';
import { forbidden, invalid, notFound, conflict } from '@/lib/errors';
import { audit, currentPolicy, type Actor } from './core';
import { ledgerHealth } from './ledger';

function requireSupport(actor: Actor) {
  if (!actor.isSupport) throw forbidden();
}

/** Filas do painel de suporte. Nenhuma lista expõe CPF/CNPJ, endereço exato ou conteúdo de chat. */
export async function supportQueues(actor: Actor) {
  requireSupport(actor);
  const [organizations, disputes, penalties, penaltyReviews, reports, failedEvents, audits] = await Promise.all([
    q<{ id: string; name: string; approval_status: string; owner_name: string; created_at: Date }>(
      `SELECT o.id, o.name, o.approval_status, u.name AS owner_name, o.created_at FROM organizations o JOIN users u ON u.id = o.owner_id
        ORDER BY (o.approval_status = 'pending_review') DESC, o.created_at DESC LIMIT 50`),
    q<{ id: string; contract_id: string; status: string; reason: string; created_at: Date; title: string; funded_cents: number }>(
      `SELECT d.id, d.contract_id, d.status, d.reason, d.created_at, r.title, u.funded_cents
         FROM disputes d JOIN work_units u ON u.id = d.unit_id JOIN contracts k ON k.id = d.contract_id JOIN service_requests r ON r.id = k.request_id
        ORDER BY (d.status = 'open') DESC, d.created_at DESC LIMIT 50`),
    q<{ id: string; user_name: string; kind: string; amount_cents: number; status: string; settlement: string; reason: string; created_at: Date }>(
      `SELECT p.id, u.name AS user_name, p.kind, p.amount_cents, p.status, p.settlement, p.reason, p.created_at
         FROM penalties p JOIN users u ON u.id = p.user_id ORDER BY p.created_at DESC LIMIT 50`),
    q<{ id: string; user_id: string; user_name: string; status: string; decision: string | null; created_at: Date; valid_count: number }>(
      `SELECT pr.id, pr.user_id, u.name AS user_name, pr.status, pr.decision, pr.created_at,
              (SELECT count(*)::int FROM penalties p WHERE p.user_id = pr.user_id AND p.status = 'valid') AS valid_count
         FROM penalty_reviews pr JOIN users u ON u.id = pr.user_id ORDER BY (pr.status = 'open') DESC, pr.created_at DESC LIMIT 50`),
    q<{ id: string; reporter_name: string; target_name: string; reason: string; details: string; status: string; created_at: Date; contract_id: string | null }>(
      `SELECT rp.id, a.name AS reporter_name, b.name AS target_name, rp.reason, rp.details, rp.status, rp.created_at, rp.contract_id
         FROM reports rp JOIN users a ON a.id = rp.reporter_id JOIN users b ON b.id = rp.target_user_id
        ORDER BY (rp.status = 'open') DESC, rp.created_at DESC LIMIT 50`),
    q<{ id: string; event_id: string; type: string; status: string; attempts: number; error: string | null; received_at: Date }>(
      `SELECT id, event_id, type, status, attempts, error, received_at FROM provider_events WHERE status <> 'processed' ORDER BY received_at DESC LIMIT 50`),
    q<{ id: string; actor_name: string | null; action: string; resource_type: string; resource_id: string; reason: string | null; created_at: Date }>(
      `SELECT a.id, u.name AS actor_name, a.action, a.resource_type, a.resource_id, a.reason, a.created_at
         FROM audit_events a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.created_at DESC LIMIT 40`),
  ]);
  return { organizations, disputes, penalties, penaltyReviews, reports, failedEvents, audits };
}

export async function getDisputeForSupport(actor: Actor, disputeId: string) {
  requireSupport(actor);
  const d = await q1<{
    id: string; contract_id: string; unit_id: string; opened_by: string; reason: string; status: string; resolution: string | null;
    worker_cents: number | null; resolution_note: string | null; created_at: Date;
  }>('SELECT * FROM disputes WHERE id = $1', [disputeId]);
  if (!d) throw notFound();
  const events = await q<{ kind: string; note: string; created_at: Date; actor_name: string }>(
    'SELECT e.kind, e.note, e.created_at, u.name AS actor_name FROM dispute_events e JOIN users u ON u.id = e.actor_id WHERE e.dispute_id=$1 ORDER BY e.created_at', [disputeId],
  );
  return { dispute: d, events };
}

export async function closeReport(actor: Actor, reportId: string, noteRaw: string) {
  requireSupport(actor);
  const note = noteRaw.trim();
  if (note.length < 5) throw invalid('Informe o encaminhamento dado à denúncia.');
  await tx(async () => {
    const r = await q1<{ status: string }>('SELECT status FROM reports WHERE id=$1 FOR UPDATE', [reportId]);
    if (!r) throw notFound();
    if (r.status !== 'open') throw conflict('bad_state', 'Esta denúncia já foi encerrada.');
    await q(`UPDATE reports SET status='closed', resolution_note=$2, handled_by=$3, closed_at=$4 WHERE id=$1`, [reportId, note, actor.id, now()]);
    await audit(actor.id, 'report.close', 'report', reportId, note);
  });
}

/**
 * Conciliação (mock): confere a consistência interna do ledger e compara o que o provedor simulado diz ter
 * recebido/pago com o que o ledger registrou. Divergências aparecem para o suporte.
 */
export async function reconciliation(actor: Actor) {
  requireSupport(actor);
  const health = await ledgerHealth();
  const ledgerIn = Number((await q1<{ s: number }>(
    `SELECT COALESCE(-sum(e.amount_cents),0)::bigint AS s FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id WHERE a.kind='provider_clearing'`))!.s);
  const ledgerOut = Number((await q1<{ s: number }>(
    `SELECT COALESCE(sum(e.amount_cents),0)::bigint AS s FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id WHERE a.kind='provider_payout'`))!.s);
  const providerIn = Number((await q1<{ s: number }>(
    `SELECT COALESCE(sum(m.amount_cents),0)::bigint AS s FROM mock_provider_objects m WHERE m.kind='payment' AND m.status='succeeded'`))!.s);
  const providerOut = Number((await q1<{ s: number }>(
    `SELECT COALESCE(sum(m.amount_cents),0)::bigint AS s FROM mock_provider_objects m WHERE m.kind='payout' AND m.status='succeeded'`))!.s);
  const pendingEvents = (await q1<{ c: number }>(`SELECT count(*)::int AS c FROM provider_events WHERE status <> 'processed'`))!.c;
  return {
    health,
    provider: { name: config.paymentProvider, receivedCents: providerIn, paidOutCents: providerOut },
    ledger: { receivedCents: ledgerIn, paidOutCents: ledgerOut },
    pendingEvents,
    ok: health.ok && ledgerIn === providerIn && ledgerOut === providerOut && pendingEvents === 0,
  };
}

export async function mockProviderObjects(actor: Actor) {
  requireSupport(actor);
  return q<{ ref: string; kind: string; amount_cents: number; status: string; created_at: Date }>(
    'SELECT ref, kind, amount_cents, status, created_at FROM mock_provider_objects ORDER BY created_at DESC LIMIT 60',
  );
}

export async function policyOverview(actor: Actor) {
  requireSupport(actor);
  const row = await q1<{ version: number; status: string }>('SELECT version, status FROM policy_versions ORDER BY version DESC LIMIT 1');
  return { policy: await currentPolicy(), status: row!.status, feeConfigured: config.platformFeeBps != null, features: config.features };
}

import { closeDb, q, q1 } from '@/lib/db';
import { setTestNow, now, addMinutes } from '@/lib/clock';
import { cpfCheckDigits } from '@/lib/crypto';
import type { Actor } from '@/modules/core';
import { register } from '@/modules/identity';
import { approveProposal } from '@/modules/contracts';
import { createContractPayment, simulatePaymentOutcome } from '@/modules/payments';
import { submitProposal } from '@/modules/proposals';
import { createRequest, publishRequest, type RequestInput } from '@/modules/requests';
import { startWork } from '@/modules/contracts';
import { submitCompletion } from '@/modules/settlement';
import type { MockScenario } from '@/modules/gateway';

export const T0 = new Date('2026-11-16T12:00:00Z');
export const SP = { lat: -23.5505, lng: -46.6333 };

let seq = 0;

/** Banco em memória novo e relógio fixo. */
export async function freshDb() {
  await closeDb();
  setTestNow(T0);
}

export const advance = (minutes: number) => setTestNow(addMinutes(now(), minutes));

/** CPF sintético (dígitos verificadores calculados sobre base sequencial); não corresponde a pessoa conhecida. */
export const fakeCpf = (n: number) => {
  const base = String(100_000_000 + n).slice(0, 9);
  return base + cpfCheckDigits(base);
};

export async function mkUser(name: string, opts: { verified?: boolean; support?: boolean } = {}): Promise<Actor> {
  seq++;
  const u = await register({
    name, email: `u${seq}@teste.invalid`, phone: '11900000000', cpf: fakeCpf(seq), birthDate: '1990-01-01', password: 'senha-de-teste',
  });
  if (opts.verified !== false) await q(`UPDATE users SET phone_verified_at=$2, identity_status='verified' WHERE id=$1`, [u.id, now()]);
  if (opts.support) await q('UPDATE users SET is_support=true WHERE id=$1', [u.id]);
  return { id: u.id, isSupport: !!opts.support };
}

export async function categoryId(slug = 'limpeza'): Promise<string> {
  return (await q1<{ id: string }>('SELECT id FROM categories WHERE slug=$1', [slug]))!.id;
}

export async function mkWorker(name: string, opts: { verified?: boolean; online?: boolean; lat?: number; lng?: number; slug?: string } = {}): Promise<Actor> {
  const a = await mkUser(name, { verified: opts.verified });
  await q(
    `INSERT INTO worker_profiles (user_id, bio, radius_km, city, uf, lat, lng, online_until) VALUES ($1,'',20,'São Paulo','SP',$2,$3,$4)`,
    [a.id, opts.lat ?? SP.lat + 0.01, opts.lng ?? SP.lng, opts.online === false ? null : addMinutes(now(), 600)],
  );
  await q('INSERT INTO worker_skills (user_id, category_id) VALUES ($1,$2)', [a.id, await categoryId(opts.slug)]);
  return a;
}

export async function mkRequest(client: Actor, over: Partial<RequestInput> = {}): Promise<string> {
  const id = await createRequest(client, {
    categoryId: await categoryId(), kind: 'urgent', title: 'Limpeza de cozinha', description: 'Limpeza completa de cozinha pequena.',
    seats: 1, priceCents: 12000, billingUnit: 'fixed', paymentKind: 'digital', durationMinutes: 120,
    uf: 'SP', city: 'São Paulo', area: 'Centro', street: 'Rua Fictícia', number: '100', lat: SP.lat, lng: SP.lng, ...over,
  });
  await publishRequest(client, id);
  return id;
}

export async function currentVersionId(proposalId: string): Promise<string> {
  return (await q1<{ id: string }>(
    'SELECT v.id FROM proposal_versions v JOIN proposals p ON p.id = v.proposal_id AND p.current_version = v.version_no WHERE p.id=$1', [proposalId],
  ))!.id;
}

/** Proposta do trabalhador + aprovação do contratante. */
export async function hire(client: Actor, worker: Actor, requestId: string, mode = 'pix', amountCents?: number) {
  const proposalId = await submitProposal(worker, requestId, { amountCents });
  const r = await approveProposal(client, proposalId, { versionId: await currentVersionId(proposalId), paymentMode: mode });
  return { proposalId, ...r };
}

export async function pay(client: Actor, contractId: string, scenario: MockScenario = 'success') {
  const p = await createContractPayment(client, contractId, { method: 'pix' });
  await simulatePaymentOutcome(client, p.id, scenario);
  return p;
}

/** Contrato digital financiado, iniciado e com conclusão solicitada. */
export async function fundedAndSubmitted(client: Actor, worker: Actor, over: Partial<RequestInput> = {}) {
  const requestId = await mkRequest(client, over);
  const h = await hire(client, worker, requestId);
  await pay(client, h.contractId);
  await startWork(worker, h.contractId);
  await submitCompletion(worker, h.unitId, { summary: 'Cozinha limpa conforme combinado.' });
  return { requestId, ...h };
}

export const balance = async (kind: string, owner: { userId?: string; unitId?: string } = {}) =>
  (await q1<{ b: number }>(
    'SELECT balance_cents AS b FROM ledger_accounts WHERE kind=$1 AND user_id IS NOT DISTINCT FROM $2::uuid AND unit_id IS NOT DISTINCT FROM $3::uuid',
    [kind, owner.userId ?? null, owner.unitId ?? null],
  ))?.b ?? 0;

export const count = async (sql: string, params: unknown[] = []) => (await q1<{ c: number }>(`SELECT count(*)::int AS c FROM ${sql}`, params))!.c;

export const status = async (table: string, id: string) => (await q1<{ status: string }>(`SELECT status FROM ${table} WHERE id=$1`, [id]))!.status;

/** Captura o AppError de uma promessa que deve falhar. */
export async function failure(p: Promise<unknown>): Promise<{ status: number; code: string }> {
  try {
    await p;
  } catch (e) {
    const err = e as { status?: number; code?: string };
    if (err.status && err.code) return { status: err.status, code: err.code };
    throw e;
  }
  throw new Error('esperava falha, mas a operação teve sucesso');
}

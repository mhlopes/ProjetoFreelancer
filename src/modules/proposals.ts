import { q, q1, tx } from '@/lib/db';
import { now } from '@/lib/clock';
import { conflict, forbidden, invalid, notFound, rule } from '@/lib/errors';
import { isBlockedBetween, isUuid, notify, rateLimit, type Actor } from './core';
import { requireEligibleWorker } from './identity';
import { assertCanEngage, type ServiceRequest } from './requests';

export type Proposal = {
  id: string; request_id: string; worker_id: string; current_version: number; created_at: Date; updated_at: Date;
  status: 'submitted' | 'countered' | 'accepted' | 'rejected' | 'withdrawn' | 'expired';
};
export type ProposalVersion = {
  id: string; proposal_id: string; version_no: number; author_id: string; amount_cents: number;
  billing_unit: 'fixed' | 'hour'; scope: string; worker_agreed_at: Date | null; created_at: Date;
};

function checkTerms(amountCents: number, scope: string) {
  if (!Number.isSafeInteger(amountCents) || amountCents < 100) throw invalid('Informe um valor válido.');
  if (scope.trim().length < 3 || scope.length > 2000) throw invalid('Descreva o escopo da proposta.');
}

/**
 * Trabalhador elegível registra proposta (inclusive ao aceitar o preço anunciado).
 * Registrar proposta NUNCA contrata: a contratação depende da aprovação do contratante.
 */
export async function submitProposal(actor: Actor, requestId: string, input: { amountCents?: number; scope?: string }): Promise<string> {
  if (!isUuid(requestId)) throw notFound();
  await requireEligibleWorker(actor.id);
  await rateLimit('proposal', actor.id, 30, 3600);
  return tx(async () => {
    const r = await q1<ServiceRequest>('SELECT * FROM service_requests WHERE id = $1 FOR SHARE', [requestId]);
    const dispatched = r && (await q1('SELECT 1 FROM request_dispatches WHERE request_id=$1 AND worker_id=$2', [requestId, actor.id]));
    if (!r || !dispatched) throw notFound();
    if (r.status !== 'open' || r.expires_at! <= now()) throw conflict('request_closed', 'Este pedido não recebe mais propostas.');
    await assertCanEngage(actor.id, r);
    const skill = await q1('SELECT 1 FROM worker_skills WHERE user_id=$1 AND category_id=$2', [actor.id, r.category_id]);
    if (!skill) throw rule('no_skill', 'Seu perfil não inclui esta categoria de serviço.');
    const live = await q1(`SELECT 1 FROM proposals WHERE request_id=$1 AND worker_id=$2 AND status IN ('submitted','countered','accepted')`, [requestId, actor.id]);
    if (live) throw conflict('proposal_exists', 'Você já tem uma proposta em andamento neste pedido.');
    const amount = input.amountCents ?? r.price_cents; // sem valor = aceita o preço anunciado
    const scope = (input.scope ?? '').trim() || r.title;
    checkTerms(amount, scope);
    const p = await q1<{ id: string }>(
      `INSERT INTO proposals (request_id, worker_id, status, current_version, created_at, updated_at) VALUES ($1,$2,'submitted',1,$3,$3) RETURNING id`,
      [requestId, actor.id, now()],
    );
    await q(
      `INSERT INTO proposal_versions (proposal_id, version_no, author_id, amount_cents, billing_unit, scope, created_at) VALUES ($1,1,$2,$3,$4,$5,$6)`,
      [p!.id, actor.id, amount, r.billing_unit, scope, now()],
    );
    await q(
      `INSERT INTO conversations (request_id, client_id, worker_id, created_at) VALUES ($1,$2,$3,$4) ON CONFLICT (request_id, worker_id) DO NOTHING`,
      [requestId, r.owner_id, actor.id, now()],
    );
    await notify(r.owner_id, 'proposal.submitted', 'Nova proposta', r.title, `/contratar/pedidos/${requestId}`, `proposal:${p!.id}:1`);
    return p!.id;
  });
}

async function lockProposal(id: string): Promise<{ p: Proposal; r: ServiceRequest }> {
  if (!isUuid(id)) throw notFound();
  const p = await q1<Proposal>('SELECT * FROM proposals WHERE id = $1 FOR UPDATE', [id]);
  if (!p) throw notFound();
  const r = (await q1<ServiceRequest>('SELECT * FROM service_requests WHERE id = $1', [p.request_id]))!;
  return { p, r };
}

/** Contraproposta: cria nova versão; as anteriores ficam no histórico. expectedVersion evita responder a versão desatualizada. */
export async function counterOffer(actor: Actor, proposalId: string, input: { amountCents: number; scope: string; expectedVersion: number }) {
  checkTerms(input.amountCents, input.scope);
  await tx(async () => {
    const { p, r } = await lockProposal(proposalId);
    const isWorker = p.worker_id === actor.id, isOwner = r.owner_id === actor.id;
    if (!isWorker && !isOwner) throw notFound();
    if (!['submitted', 'countered'].includes(p.status)) throw conflict('bad_state', 'Esta negociação já foi encerrada.');
    if (r.status !== 'open') throw conflict('request_closed', 'Este pedido não está aberto a negociações.');
    if (p.current_version !== input.expectedVersion) throw conflict('stale_proposal', 'A proposta foi atualizada. Revise a versão mais recente.');
    if (await isBlockedBetween(p.worker_id, r.owner_id)) throw forbidden('Não é possível interagir com este usuário.');
    const v = p.current_version + 1;
    await q(
      `INSERT INTO proposal_versions (proposal_id, version_no, author_id, amount_cents, billing_unit, scope, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [p.id, v, actor.id, input.amountCents, r.billing_unit, input.scope.trim(), now()],
    );
    await q('UPDATE proposals SET current_version=$2, status=$3, updated_at=$4 WHERE id=$1', [p.id, v, isWorker ? 'submitted' : 'countered', now()]);
    const target = isWorker ? r.owner_id : p.worker_id;
    await notify(target, 'proposal.countered', 'Nova contraproposta', r.title,
      isWorker ? `/contratar/pedidos/${r.id}` : `/trabalhar/chamados/${r.id}`, `proposal:${p.id}:${v}`);
  });
}

/** Trabalhador concorda com a contraproposta do contratante. Ainda não é contratação: o contratante aprova depois. */
export async function agreeToCounter(actor: Actor, proposalId: string, expectedVersion: number) {
  await requireEligibleWorker(actor.id);
  await tx(async () => {
    const { p, r } = await lockProposal(proposalId);
    if (p.worker_id !== actor.id) throw notFound();
    if (p.status !== 'countered') throw conflict('bad_state', 'Não há contraproposta aguardando sua resposta.');
    if (p.current_version !== expectedVersion) throw conflict('stale_proposal', 'A proposta foi atualizada. Revise a versão mais recente.');
    await q('UPDATE proposal_versions SET worker_agreed_at=$3 WHERE proposal_id=$1 AND version_no=$2', [p.id, p.current_version, now()]);
    await q(`UPDATE proposals SET status='submitted', updated_at=$2 WHERE id=$1`, [p.id, now()]);
    await notify(r.owner_id, 'proposal.agreed', 'Profissional concordou com sua contraproposta', `${r.title}: falta sua aprovação.`,
      `/contratar/pedidos/${r.id}`, `proposal.agreed:${p.id}:${p.current_version}`);
  });
}

export async function rejectProposal(actor: Actor, proposalId: string) {
  await tx(async () => {
    const { p, r } = await lockProposal(proposalId);
    if (r.owner_id !== actor.id) throw notFound();
    if (!['submitted', 'countered'].includes(p.status)) throw conflict('bad_state', 'Esta negociação já foi encerrada.');
    await q(`UPDATE proposals SET status='rejected', updated_at=$2 WHERE id=$1`, [p.id, now()]);
    await notify(p.worker_id, 'proposal.rejected', 'Proposta recusada', r.title, `/trabalhar/chamados/${r.id}`, `proposal.rejected:${p.id}`);
  });
}

export async function withdrawProposal(actor: Actor, proposalId: string) {
  await tx(async () => {
    const { p } = await lockProposal(proposalId);
    if (p.worker_id !== actor.id) throw notFound();
    if (!['submitted', 'countered'].includes(p.status)) throw conflict('bad_state', 'Esta negociação já foi encerrada.');
    await q(`UPDATE proposals SET status='withdrawn', updated_at=$2 WHERE id=$1`, [p.id, now()]);
  });
}

export type ProposalWithVersions = Proposal & { worker_name: string; versions: ProposalVersion[] };

async function withVersions(rows: (Proposal & { worker_name: string })[]): Promise<ProposalWithVersions[]> {
  const out: ProposalWithVersions[] = [];
  for (const p of rows) {
    const versions = await q<ProposalVersion>('SELECT * FROM proposal_versions WHERE proposal_id = $1 ORDER BY version_no', [p.id]);
    out.push({ ...p, versions });
  }
  return out;
}

/** Dono vê todas as propostas do pedido. */
export async function listProposalsForOwner(actor: Actor, requestId: string): Promise<ProposalWithVersions[]> {
  const r = await q1<{ owner_id: string }>('SELECT owner_id FROM service_requests WHERE id=$1', [requestId]);
  if (!r || r.owner_id !== actor.id) throw notFound();
  return withVersions(await q(
    `SELECT p.*, u.name AS worker_name FROM proposals p JOIN users u ON u.id = p.worker_id WHERE p.request_id=$1 ORDER BY p.created_at`,
    [requestId],
  ));
}

/** Candidato vê apenas a própria negociação, nunca a de outros candidatos. */
export async function listMyProposals(actor: Actor, requestId: string): Promise<ProposalWithVersions[]> {
  return withVersions(await q(
    `SELECT p.*, u.name AS worker_name FROM proposals p JOIN users u ON u.id = p.worker_id
      WHERE p.request_id=$1 AND p.worker_id=$2 ORDER BY p.created_at DESC`,
    [requestId, actor.id],
  ));
}

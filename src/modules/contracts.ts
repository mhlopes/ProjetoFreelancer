import { q, q1, tx } from '@/lib/db';
import { now, addMinutes } from '@/lib/clock';
import { hourlyAmount } from '@/lib/money';
import { conflict, forbidden, invalid, notFound, rule } from '@/lib/errors';
import { audit, currentPolicy, isBlockedBetween, isUuid, notify, type Actor, type Policy } from './core';
import { isWorkerEligible, getUser } from './identity';
import { account, post } from './ledger';
import { getCategory } from './profiles';
import type { Proposal, ProposalVersion } from './proposals';
import type { RequestLocation, ServiceRequest } from './requests';

export type ContractStatus =
  | 'awaiting_funding' | 'confirmed' | 'en_route' | 'in_progress' | 'completion_requested' | 'completed' | 'cancelled';
export type Contract = {
  id: string; request_id: string; client_id: string; worker_id: string; proposal_id: string; accepted_version_id: string;
  status: ContractStatus; payment_mode: 'pix' | 'card' | 'wallet' | 'cash'; billing_unit: 'fixed' | 'hour';
  amount_cents: number; budget_cents: number; kind: 'urgent' | 'scheduled'; starts_at: Date; ends_at: Date; timezone: string;
  policy_version: number; policy_snapshot: Policy; confirmed_at: Date | null; departed_at: Date | null;
  started_at: Date | null; completed_at: Date | null; cancelled_at: Date | null; created_at: Date;
};
export type UnitStatus =
  | 'planned' | 'awaiting_funding' | 'funded' | 'in_progress' | 'submitted' | 'approved' | 'released' | 'disputed'
  | 'resolved' | 'cancelled' | 'external_due' | 'external_reported' | 'external_confirmed';
export type WorkUnit = {
  id: string; contract_id: string; scope: string; budget_cents: number; funded_cents: number; status: UnitStatus;
  status_before_dispute: UnitStatus | null; summary: string | null; reported_minutes: number | null;
  pending_correction_minutes: number | null; submitted_at: Date | null; deadline_at: Date | null; released_at: Date | null;
  released_worker_cents: number | null; released_fee_cents: number | null; refunded_cents: number | null;
};

export const PAYMENT_MODES = ['pix', 'card', 'wallet', 'cash'] as const;

/** Libera reservas temporárias vencidas e cancela os contratos que não foram financiados a tempo (P03). */
export async function expireFundingHolds(filter: { workerId?: string; requestId?: string } = {}): Promise<number> {
  const rows = await q<{ contract_id: string }>(
    `SELECT sr.contract_id FROM schedule_reservations sr JOIN contracts k ON k.id = sr.contract_id
      WHERE sr.state = 'held' AND sr.expires_at <= $1
        AND ($2::uuid IS NULL OR sr.worker_id = $2) AND ($3::uuid IS NULL OR k.request_id = $3)`,
    [now(), filter.workerId ?? null, filter.requestId ?? null],
  );
  let n = 0;
  for (const { contract_id } of rows) {
    await tx(async () => {
      const c = await q1<Contract>('SELECT * FROM contracts WHERE id = $1 FOR UPDATE', [contract_id]);
      if (!c || c.status !== 'awaiting_funding') return;
      await closeContractAsCancelled(c, { by: null, responsible: 'none', kind: 'funding_timeout', reason: 'Pagamento não confirmado dentro do prazo da reserva.' });
      await notify(c.client_id, 'contract.funding_timeout', 'Reserva expirada', 'O pagamento não foi confirmado a tempo e a vaga foi liberada.',
        `/contratar/pedidos/${c.request_id}`, `funding_timeout:${c.id}:client`);
      await notify(c.worker_id, 'contract.funding_timeout', 'Reserva expirada', 'O contratante não concluiu o pagamento a tempo.',
        `/trabalhar/chamados/${c.request_id}`, `funding_timeout:${c.id}:worker`);
      n++;
    });
  }
  return n;
}

/** Fechamento estrutural do cancelamento (estado, agenda, unidade). O fechamento financeiro é tratado à parte. */
export async function closeContractAsCancelled(
  c: Contract,
  info: { by: string | null; responsible: 'client' | 'worker' | 'none'; kind: 'free' | 'penalty' | 'no_show' | 'funding_timeout' | 'dispute_refund'; reason: string },
) {
  const t = now();
  await q(`UPDATE contracts SET status='cancelled', cancelled_at=$2, updated_at=$2 WHERE id=$1`, [c.id, t]);
  await q(`UPDATE schedule_reservations SET state = CASE WHEN state='held' AND $2 THEN 'expired' ELSE 'released' END
            WHERE contract_id=$1 AND state IN ('held','confirmed')`, [c.id, info.kind === 'funding_timeout']);
  await q(`UPDATE work_units SET status='cancelled', updated_at=$2 WHERE contract_id=$1 AND status NOT IN ('released','resolved','cancelled')`, [c.id, t]);
  await q(`UPDATE proposals SET status='expired', updated_at=$2 WHERE id=$1 AND status='accepted'`, [c.proposal_id, t]);
  await q(
    `INSERT INTO cancellations (contract_id, cancelled_by, responsible, kind, reason, policy_version, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [c.id, info.by, info.responsible, info.kind, info.reason, c.policy_version, t],
  );
}

/**
 * Contratante aprova um profissional (versão exata da proposta). É o único caminho que cria contrato.
 * Tudo sob trava do pedido: contagem de vagas, agenda do trabalhador e reserva temporária.
 * Digital: contrato nasce "aguardando pagamento" com reserva de vaga/agenda por tempo limitado.
 * Espécie: contrato confirmado após aceite das condições, sem cobrança digital.
 */
export async function approveProposal(
  actor: Actor,
  proposalId: string,
  input: { versionId: string; paymentMode: string; expectedRequestVersion?: number },
): Promise<{ contractId: string; unitId: string; status: ContractStatus }> {
  if (!isUuid(proposalId) || !isUuid(input.versionId)) throw notFound();
  if (!(PAYMENT_MODES as readonly string[]).includes(input.paymentMode)) throw invalid('Forma de pagamento inválida.');
  const mode = input.paymentMode as Contract['payment_mode'];
  return tx(async () => {
    const pre = await q1<{ request_id: string }>('SELECT request_id FROM proposals WHERE id = $1', [proposalId]);
    if (!pre) throw notFound();
    // trava do pedido primeiro: serializa aprovações concorrentes da última vaga
    const r = await q1<ServiceRequest>('SELECT * FROM service_requests WHERE id = $1 FOR UPDATE', [pre.request_id]);
    if (!r || r.owner_id !== actor.id) throw notFound();
    const p = (await q1<Proposal>('SELECT * FROM proposals WHERE id = $1 FOR UPDATE', [proposalId]))!;
    const t = now();
    if (r.status !== 'open' || r.expires_at! <= t) throw conflict('request_closed', 'O pedido não está aberto. Renove-o para contratar.');
    if (input.expectedRequestVersion != null && input.expectedRequestVersion !== r.version)
      throw conflict('stale_request', 'O pedido foi alterado. Revise antes de aprovar.');
    if (p.status !== 'submitted') throw conflict('stale_proposal', 'Esta proposta não está aguardando sua aprovação.');
    const v = await q1<ProposalVersion>('SELECT * FROM proposal_versions WHERE id = $1 AND proposal_id = $2', [input.versionId, p.id]);
    if (!v || v.version_no !== p.current_version) throw conflict('stale_proposal', 'A proposta foi atualizada. Revise a versão mais recente.');
    // só contrata versão com a qual o trabalhador concordou: escrita por ele ou aceita explicitamente
    if (v.author_id !== p.worker_id && !v.worker_agreed_at) throw conflict('stale_proposal', 'O profissional ainda não concordou com esta versão.');
    if (p.worker_id === r.owner_id) throw rule('self_hire', 'Não é possível contratar a si mesmo.');
    const cat = await getCategory(r.category_id);
    if (!cat.enabled) throw rule('category_disabled', 'Esta categoria ainda não está habilitada para contratação.');
    if (await isBlockedBetween(p.worker_id, r.owner_id)) throw forbidden('Não é possível contratar este usuário.');
    if (!isWorkerEligible(await getUser(p.worker_id))) throw rule('worker_not_verified', 'O profissional não está apto a ser contratado no momento.');
    if ((r.payment_kind === 'cash') !== (mode === 'cash'))
      throw rule('payment_mode', r.payment_kind === 'cash' ? 'Este pedido foi combinado em dinheiro físico.' : 'Este pedido exige pagamento digital.');

    await expireFundingHolds({ requestId: r.id });
    await expireFundingHolds({ workerId: p.worker_id });

    const taken = await q1<{ c: number }>(`SELECT count(*)::int AS c FROM contracts WHERE request_id = $1 AND status <> 'cancelled'`, [r.id]);
    if (taken!.c >= r.seats) throw conflict('no_seats', 'Todas as vagas deste pedido já foram preenchidas.');

    const startsAt = r.kind === 'urgent' ? t : r.starts_at!;
    const endsAt = addMinutes(startsAt, r.duration_minutes);
    const overlap = await q1(
      `SELECT 1 FROM schedule_reservations WHERE worker_id = $1 AND state IN ('held','confirmed') AND during && tstzrange($2,$3,'[)')`,
      [p.worker_id, startsAt, endsAt],
    );
    if (overlap) throw conflict('schedule_conflict', 'O profissional já tem um compromisso neste horário.');

    const policy = await currentPolicy();
    const budget = v.billing_unit === 'hour' ? hourlyAmount(v.amount_cents, r.duration_minutes) : v.amount_cents;
    const cash = mode === 'cash';
    const c = await q1<Contract>(
      `INSERT INTO contracts (request_id, client_id, worker_id, proposal_id, accepted_version_id, status, payment_mode, billing_unit,
          amount_cents, budget_cents, kind, starts_at, ends_at, timezone, policy_version, policy_snapshot, confirmed_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18) RETURNING *`,
      [r.id, r.owner_id, p.worker_id, p.id, v.id, cash ? 'confirmed' : 'awaiting_funding', mode, v.billing_unit, v.amount_cents, budget,
        r.kind, startsAt, endsAt, r.timezone, policy.version, JSON.stringify(policy), cash ? t : null, t],
    );
    // A constraint de exclusão do banco é a garantia final contra sobreposição.
    await q(
      `INSERT INTO schedule_reservations (worker_id, contract_id, during, state, expires_at) VALUES ($1,$2,tstzrange($3,$4,'[)'),$5,$6)`,
      [p.worker_id, c!.id, startsAt, endsAt, cash ? 'confirmed' : 'held', cash ? null : addMinutes(t, policy.fundingReservationMinutes)],
    );
    const unit = await q1<{ id: string }>(
      `INSERT INTO work_units (contract_id, scope, budget_cents, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$5) RETURNING id`,
      [c!.id, v.scope, budget, cash ? 'external_due' : 'awaiting_funding', t],
    );
    await q(`UPDATE proposals SET status='accepted', updated_at=$2 WHERE id=$1`, [p.id, t]);

    let status: ContractStatus = c!.status;
    if (mode === 'wallet') {
      // Pagamento com crédito da carteira: transferência interna imediata, sem provedor.
      if (budget > 0)
        await post({
          kind: 'funding_wallet', key: `fund_wallet:${unit!.id}`, refType: 'unit', refId: unit!.id, memo: 'Pagamento com crédito da carteira',
          legs: [
            { account: await account('client_wallet', { userId: r.owner_id }), amount: -budget },
            { account: await account('unit_reserve', { unitId: unit!.id }), amount: budget },
          ],
        });
      await confirmFunding(c!.id, unit!.id, budget);
      status = 'confirmed';
    } else if (cash) {
      await notify(p.worker_id, 'contract.confirmed', 'Você foi contratado', `${r.title} — pagamento em dinheiro, direto com o contratante.`,
        `/contratos/${c!.id}`, `contract.confirmed:${c!.id}`);
    } else {
      await notify(p.worker_id, 'contract.approved', 'Contratante aprovou sua proposta', `${r.title}: aguardando confirmação do pagamento.`,
        `/contratos/${c!.id}`, `contract.approved:${c!.id}`);
    }
    return { contractId: c!.id, unitId: unit!.id, status };
  });
}

/** Fundos confirmados para a unidade: contrato confirmado, reserva de agenda definitiva. Chamado sob transação. */
export async function confirmFunding(contractId: string, unitId: string, amountCents: number) {
  const t = now();
  await q(`UPDATE contracts SET status='confirmed', confirmed_at=$2, updated_at=$2 WHERE id=$1 AND status='awaiting_funding'`, [contractId, t]);
  await q(`UPDATE schedule_reservations SET state='confirmed', expires_at=NULL WHERE contract_id=$1 AND state='held'`, [contractId]);
  await q(`UPDATE work_units SET status='funded', funded_cents=$2, updated_at=$3 WHERE id=$1 AND status='awaiting_funding'`, [unitId, amountCents, t]);
  const c = (await q1<Contract>('SELECT * FROM contracts WHERE id=$1', [contractId]))!;
  await notify(c.worker_id, 'contract.confirmed', 'Contratação confirmada', 'Pagamento confirmado e retido até a conclusão. Veja o endereço e os detalhes.',
    `/contratos/${c.id}`, `contract.confirmed:${c.id}`);
  await notify(c.client_id, 'contract.confirmed', 'Pagamento confirmado', 'O profissional foi contratado. O valor fica retido até a conclusão.',
    `/contratos/${c.id}`, `contract.confirmed:${c.id}:client`);
}

async function lockAsWorker(actor: Actor, contractId: string): Promise<Contract> {
  if (!isUuid(contractId)) throw notFound();
  const c = await q1<Contract>('SELECT * FROM contracts WHERE id = $1 FOR UPDATE', [contractId]);
  if (!c || (c.worker_id !== actor.id && c.client_id !== actor.id)) throw notFound();
  if (c.worker_id !== actor.id) throw forbidden('Somente o profissional contratado pode fazer isto.');
  return c;
}

export async function markDeparture(actor: Actor, contractId: string) {
  await tx(async () => {
    const c = await lockAsWorker(actor, contractId);
    if (c.status !== 'confirmed') throw conflict('bad_state', 'O deslocamento só pode ser registrado em contrato confirmado.');
    await q(`UPDATE contracts SET status='en_route', departed_at=$2, updated_at=$2 WHERE id=$1`, [c.id, now()]);
    await notify(c.client_id, 'contract.en_route', 'Profissional a caminho', 'O profissional registrou o início do deslocamento.', `/contratos/${c.id}`, `contract.en_route:${c.id}`);
  });
}

export async function startWork(actor: Actor, contractId: string) {
  await tx(async () => {
    const c = await lockAsWorker(actor, contractId);
    if (c.status !== 'confirmed' && c.status !== 'en_route') throw conflict('bad_state', 'O serviço só pode iniciar após a confirmação da contratação.');
    const t = now();
    await q(`UPDATE contracts SET status='in_progress', started_at=$2, updated_at=$2 WHERE id=$1`, [c.id, t]);
    await q(`UPDATE work_units SET status='in_progress', updated_at=$2 WHERE contract_id=$1 AND status='funded'`, [c.id, t]);
    // R18: avisar no início sobre a regra de confirmação
    await notify(c.client_id, 'contract.started', 'Serviço iniciado',
      c.payment_mode === 'cash'
        ? 'O profissional iniciou o serviço. O pagamento em dinheiro é combinado diretamente entre vocês.'
        : `O profissional iniciou o serviço. Quando ele registrar a conclusão, você terá ${c.policy_snapshot.completionConfirmationHours}h para confirmar ou contestar; sem resposta, o pagamento é liberado.`,
      `/contratos/${c.id}`, `contract.started:${c.id}`);
  });
}

// ───────────── Consultas ─────────────

export type ContractView = {
  contract: Contract; unit: WorkUnit; role: 'client' | 'worker';
  request: Pick<ServiceRequest, 'id' | 'title' | 'description' | 'materials' | 'area' | 'city' | 'uf' | 'duration_minutes'> & { category_name: string };
  /** Endereço completo somente às partes de contrato confirmado (R12). */
  location: RequestLocation | null;
  clientName: string; workerName: string; conversationId: string | null;
  logs: { id: string; work_date: Date; minutes: number; note: string }[];
  cashConfirmedBy: string[];
  dispute: { id: string; status: string; reason: string; opened_by: string; resolution: string | null; resolution_note: string | null; worker_cents: number | null } | null;
  pendingPayment: { id: string; method: string; provider_ref: string } | null;
  holdExpiresAt: Date | null;
  cancellation: { kind: string; responsible: string; reason: string } | null;
  penalty: { amount_cents: number; user_id: string; kind: string; status: string; settlement: string } | null;
};

export async function getContractForViewer(actor: Actor, contractId: string): Promise<ContractView> {
  if (!isUuid(contractId)) throw notFound();
  const c = await q1<Contract>('SELECT * FROM contracts WHERE id = $1', [contractId]);
  if (!c || (c.client_id !== actor.id && c.worker_id !== actor.id)) throw notFound();
  const role = c.client_id === actor.id ? 'client' : 'worker';
  const unit = (await q1<WorkUnit>('SELECT * FROM work_units WHERE contract_id = $1 ORDER BY seq LIMIT 1', [c.id]))!;
  const request = (await q1<ContractView['request']>(
    `SELECT r.id, r.title, r.description, r.materials, r.area, r.city, r.uf, r.duration_minutes, cat.name AS category_name
       FROM service_requests r JOIN categories cat ON cat.id = r.category_id WHERE r.id = $1`, [c.request_id],
  ))!;
  const addressVisible = role === 'client' || ['confirmed', 'en_route', 'in_progress', 'completion_requested', 'completed'].includes(c.status);
  const location = addressVisible
    ? (await q1<RequestLocation>('SELECT street, number, complement, reference FROM request_locations WHERE request_id = $1', [c.request_id])) ?? null
    : null;
  const names = await q<{ id: string; name: string }>('SELECT id, name FROM users WHERE id IN ($1,$2)', [c.client_id, c.worker_id]);
  const conv = await q1<{ id: string }>('SELECT id FROM conversations WHERE request_id=$1 AND worker_id=$2', [c.request_id, c.worker_id]);
  const logs = await q<ContractView['logs'][number]>('SELECT id, work_date, minutes, note FROM work_logs WHERE unit_id=$1 ORDER BY work_date, created_at', [unit.id]);
  const cash = await q<{ user_id: string }>('SELECT user_id FROM cash_confirmations WHERE contract_id=$1', [c.id]);
  const dispute = await q1<NonNullable<ContractView['dispute']>>(
    'SELECT id, status, reason, opened_by, resolution, resolution_note, worker_cents FROM disputes WHERE contract_id=$1 ORDER BY created_at DESC LIMIT 1', [c.id],
  );
  const pendingPayment = role === 'client'
    ? await q1<NonNullable<ContractView['pendingPayment']>>(`SELECT id, method, provider_ref FROM payments WHERE unit_id=$1 AND status='pending' ORDER BY created_at DESC LIMIT 1`, [unit.id])
    : undefined;
  const hold = await q1<{ expires_at: Date | null }>(`SELECT expires_at FROM schedule_reservations WHERE contract_id=$1 AND state='held'`, [c.id]);
  const cancellation = await q1<NonNullable<ContractView['cancellation']>>('SELECT kind, responsible, reason FROM cancellations WHERE contract_id=$1', [c.id]);
  const penalty = await q1<NonNullable<ContractView['penalty']>>('SELECT amount_cents, user_id, kind, status, settlement FROM penalties WHERE contract_id=$1', [c.id]);
  return {
    contract: c, unit, role, request, location,
    clientName: names.find((n) => n.id === c.client_id)!.name,
    workerName: names.find((n) => n.id === c.worker_id)!.name,
    conversationId: conv?.id ?? null, logs, cashConfirmedBy: cash.map((x) => x.user_id),
    dispute: dispute ?? null, pendingPayment: pendingPayment ?? null, holdExpiresAt: hold?.expires_at ?? null,
    cancellation: cancellation ?? null, penalty: penalty ?? null,
  };
}

export type ContractListItem = Contract & { title: string; other_name: string; unit_status: UnitStatus; city: string; area: string };

export async function listContracts(actor: Actor, role: 'client' | 'worker', requestId?: string): Promise<ContractListItem[]> {
  const me = role === 'client' ? 'client_id' : 'worker_id';
  const other = role === 'client' ? 'worker_id' : 'client_id';
  return q<ContractListItem>(
    `SELECT k.*, r.title, r.city, r.area, u.name AS other_name,
            (SELECT status FROM work_units w WHERE w.contract_id = k.id ORDER BY seq LIMIT 1) AS unit_status
       FROM contracts k JOIN service_requests r ON r.id = k.request_id JOIN users u ON u.id = k.${other}
      WHERE k.${me} = $1 AND ($2::uuid IS NULL OR k.request_id = $2)
      ORDER BY k.starts_at DESC LIMIT 200`,
    [actor.id, requestId ?? null],
  );
}

/** Suporte: acesso a registros de um contrato somente por caso, com motivo, sempre auditado. */
export async function getContractForSupport(actor: Actor, contractId: string, reason: string) {
  if (!actor.isSupport) throw forbidden();
  if (reason.trim().length < 5) throw invalid('Informe o motivo do acesso.');
  const c = await q1<Contract>('SELECT * FROM contracts WHERE id = $1', [contractId]);
  if (!c) throw notFound();
  await audit(actor.id, 'support.view_contract', 'contract', contractId, reason.trim());
  const unit = (await q1<WorkUnit>('SELECT * FROM work_units WHERE contract_id=$1 ORDER BY seq LIMIT 1', [c.id]))!;
  const request = await q1<{ title: string; description: string }>('SELECT title, description FROM service_requests WHERE id=$1', [c.request_id]);
  const names = await q<{ id: string; name: string }>('SELECT id, name FROM users WHERE id IN ($1,$2)', [c.client_id, c.worker_id]);
  const messages = await q<{ sender_id: string; body: string; created_at: Date }>(
    `SELECT m.sender_id, m.body, m.created_at FROM messages m JOIN conversations cv ON cv.id = m.conversation_id
      WHERE cv.request_id=$1 AND cv.worker_id=$2 ORDER BY m.id LIMIT 500`, [c.request_id, c.worker_id],
  );
  const logs = await q<{ work_date: Date; minutes: number; note: string }>('SELECT work_date, minutes, note FROM work_logs WHERE unit_id=$1 ORDER BY work_date', [unit.id]);
  return { contract: c, unit, request: request!, names, messages, logs };
}

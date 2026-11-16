import { q, q1, tx } from '@/lib/db';
import { now, addMinutes, subMonths } from '@/lib/clock';
import { penaltyAmount } from '@/lib/money';
import { conflict, forbidden, invalid, notFound, rule } from '@/lib/errors';
import { audit, isUuid, notify, type Actor } from './core';
import { closeContractAsCancelled, type Contract, type WorkUnit } from './contracts';
import { account, findTx, post } from './ledger';

export type CancellationPreview = {
  outcome: 'free' | 'penalty' | 'requires_support' | 'not_allowed';
  responsible: 'client' | 'worker' | 'none';
  penaltyCents: number;
  /** Quem recebe a compensação (PROPOSTA R30: parte prejudicada). */
  penaltyBeneficiary: 'client' | 'worker' | null;
  /** from_reserve: descontada do valor retido. debt: vira débito separado do responsável. */
  settlement: 'from_reserve' | 'debt' | null;
  fundedCents: number;
  refundToClientCents: number;
  policyVersion: number;
  explanation: string;
};

/**
 * Regras R23–R27 com a política congelada no contrato. Função pura sobre o estado: usada tanto na prévia
 * (sem mutação) quanto na confirmação, que recalcula sob trava.
 *
 * PROPOSTA registrada (R30 pendente): o trabalhador segue os mesmos marcos do contratante.
 */
export function evaluateCancellation(c: Contract, unit: WorkUnit, role: 'client' | 'worker', t: Date): CancellationPreview {
  const pol = c.policy_snapshot;
  const funded = unit.funded_cents;
  const base: CancellationPreview = {
    outcome: 'free', responsible: 'none', penaltyCents: 0, penaltyBeneficiary: null, settlement: null,
    fundedCents: funded, refundToClientCents: funded, policyVersion: c.policy_version, explanation: '',
  };
  if (c.status === 'completed' || c.status === 'cancelled')
    return { ...base, outcome: 'not_allowed', refundToClientCents: 0, explanation: 'Este contrato já foi encerrado.' };
  if (c.status === 'in_progress' || c.status === 'completion_requested')
    // R27: trabalho iniciado não é cancelamento simples; acerta-se o executado, com suporte em divergência
    return { ...base, outcome: 'requires_support', refundToClientCents: 0,
      explanation: 'O serviço já foi iniciado. O acerto do que foi executado é feito pela conclusão normal ou, havendo divergência, por contestação analisada pelo suporte.' };
  if (c.status === 'awaiting_funding')
    return { ...base, explanation: 'Contratação ainda não confirmada: cancelamento gratuito.' };

  let free: boolean, why: string;
  if (c.kind === 'urgent') {
    free = c.status === 'confirmed';
    why = free ? 'Chamado urgente antes do início do deslocamento: cancelamento gratuito.' : 'Chamado urgente com deslocamento já iniciado: há compensação limitada.';
  } else if (c.starts_at.getTime() - t.getTime() > pol.scheduledFreeCancellationBeforeHours * 3_600_000) {
    free = true;
    why = `Faltam mais de ${pol.scheduledFreeCancellationBeforeHours}h para o serviço: cancelamento gratuito.`;
  } else if (c.status === 'confirmed' && c.confirmed_at && t <= addMinutes(c.confirmed_at, pol.scheduledBookingGraceMinutes)) {
    free = true;
    why = `Dentro da tolerância de ${pol.scheduledBookingGraceMinutes} min após a contratação: cancelamento gratuito.`;
  } else {
    free = false;
    why = `Faltam ${pol.scheduledFreeCancellationBeforeHours}h ou menos para o serviço e a tolerância terminou: há multa.`;
  }
  if (free) return { ...base, explanation: why };
  const penalty = penaltyAmount(unit.budget_cents, pol.cancellationPenaltyBps, pol.cancellationCapCents);
  return applyPenalty(base, role, penalty, funded, why);
}

function applyPenalty(base: CancellationPreview, responsible: 'client' | 'worker', penalty: number, funded: number, why: string): CancellationPreview {
  if (responsible === 'client' && funded >= penalty)
    return { ...base, outcome: 'penalty', responsible, penaltyCents: penalty, penaltyBeneficiary: 'worker', settlement: 'from_reserve',
      refundToClientCents: funded - penalty, explanation: `${why} A compensação é paga ao profissional com parte do valor retido; o restante volta à carteira do contratante.` };
  return { ...base, outcome: 'penalty', responsible, penaltyCents: penalty, penaltyBeneficiary: responsible === 'client' ? 'worker' : 'client',
    settlement: 'debt', refundToClientCents: funded,
    explanation: `${why} A multa fica registrada como débito separado do responsável${funded ? '; o valor retido volta integralmente à carteira do contratante' : ''}.` };
}

async function load(actor: Actor, contractId: string, lock: boolean) {
  if (!isUuid(contractId)) throw notFound();
  const c = await q1<Contract>(`SELECT * FROM contracts WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`, [contractId]);
  if (!c || (c.client_id !== actor.id && c.worker_id !== actor.id)) throw notFound();
  const unit = (await q1<WorkUnit>(`SELECT * FROM work_units WHERE contract_id = $1 ORDER BY seq LIMIT 1 ${lock ? 'FOR UPDATE' : ''}`, [c.id]))!;
  return { c, unit, role: (c.client_id === actor.id ? 'client' : 'worker') as 'client' | 'worker' };
}

/** Prévia sem mutação: mostra taxa, destinatário e crédito restante antes de cancelar. */
export async function previewCancellation(actor: Actor, contractId: string): Promise<CancellationPreview> {
  const { c, unit, role } = await load(actor, contractId, false);
  return evaluateCancellation(c, unit, role, now());
}

/** Fechamento financeiro e registro da multa. Uma multa por contrato (sem duplicação pelo mesmo fato). */
async function closeWithOutcome(
  actorId: string, c: Contract, unit: WorkUnit, p: CancellationPreview,
  kind: 'cancellation' | 'no_show', reason: string,
) {
  const t = now();
  const responsibleId = p.responsible === 'client' ? c.client_id : c.worker_id;
  const beneficiaryId = p.responsible === 'client' ? c.worker_id : c.client_id;
  if (unit.status === 'disputed') throw conflict('disputed', 'Há uma contestação aberta. Aguarde a análise do suporte.');
  if (p.fundedCents > 0) {
    const toWorker = p.settlement === 'from_reserve' ? p.penaltyCents : 0;
    await post({
      kind: 'cancellation', key: `cancel:${c.id}`, refType: 'contract', refId: c.id, memo: 'Fechamento financeiro do cancelamento',
      legs: [
        { account: await account('unit_reserve', { unitId: unit.id }), amount: -p.fundedCents },
        { account: await account('worker_earnings', { userId: c.worker_id }), amount: toWorker }, // compensação: sem comissão de serviço
        { account: await account('client_wallet', { userId: c.client_id }), amount: p.fundedCents - toWorker },
      ],
    });
    if (p.fundedCents - toWorker > 0)
      await q(
        `INSERT INTO refunds (unit_id, user_id, amount_cents, destination, reason, idempotency_key, created_at)
         VALUES ($1,$2,$3,'wallet','Cancelamento',$4,$5) ON CONFLICT (idempotency_key) DO NOTHING`,
        [unit.id, c.client_id, p.fundedCents - toWorker, `refund:cancel:${c.id}`, t],
      );
  }
  if (p.outcome === 'penalty' && p.penaltyCents > 0) {
    const pol = c.policy_snapshot;
    const pen = await q1<{ id: string }>(
      `INSERT INTO penalties (contract_id, unit_id, user_id, beneficiary_id, kind, base_cents, bps, cap_cents, amount_cents, settlement, policy_version, reason, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [c.id, unit.id, responsibleId, beneficiaryId, kind, unit.budget_cents,
        kind === 'no_show' ? pol.noShowPenaltyBps : pol.cancellationPenaltyBps,
        kind === 'no_show' ? pol.noShowCapCents : pol.cancellationCapCents,
        p.penaltyCents, p.settlement, c.policy_version, reason, t],
    );
    if (p.settlement === 'debt')
      // Dívida em conta própria, separada do saldo sacável. Cobrança e destino final aguardam ratificação (O05).
      await post({
        kind: 'penalty_debt', key: `penalty_debt:${pen!.id}`, refType: 'penalty', refId: pen!.id, memo: 'Multa registrada como débito',
        legs: [
          { account: await account('penalty_debt', { userId: responsibleId }), amount: -p.penaltyCents },
          { account: await account('penalty_receivable'), amount: p.penaltyCents },
        ],
      });
    await audit(actorId, 'penalty.applied', 'penalty', pen!.id, reason, {
      kind, baseCents: unit.budget_cents, amountCents: p.penaltyCents, policyVersion: c.policy_version, settlement: p.settlement,
    });
    await maybeOpenPenaltyReview(responsibleId, pen!.id);
    await notify(responsibleId, 'penalty.applied', 'Multa aplicada', 'Uma multa foi registrada. Se houver justificativa, fale com o suporte para análise.',
      `/contratos/${c.id}`, `penalty:${pen!.id}`);
  }
  await closeContractAsCancelled(c, {
    by: actorId, responsible: p.responsible, kind: kind === 'no_show' ? 'no_show' : p.outcome === 'penalty' ? 'penalty' : 'free', reason,
  });
}

/**
 * R28: três multas válidas nos últimos 12 meses encaminham para ANÁLISE do suporte.
 * Nunca suspende nem bane automaticamente. Multas anuladas não contam.
 */
async function maybeOpenPenaltyReview(userId: string, penaltyId: string) {
  const row = await q1<{ policy_snapshot: Contract['policy_snapshot'] }>(
    'SELECT k.policy_snapshot FROM penalties p JOIN contracts k ON k.id = p.contract_id WHERE p.id = $1', [penaltyId],
  );
  const pol = row!.policy_snapshot;
  const n = await q1<{ c: number }>(`SELECT count(*)::int AS c FROM penalties WHERE user_id=$1 AND status='valid' AND created_at > $2`, [
    userId, subMonths(now(), pol.penaltyLookbackCalendarMonths),
  ]);
  if (n!.c >= pol.penaltyReviewCount)
    await q(
      `INSERT INTO penalty_reviews (user_id, triggered_by, created_at)
       SELECT $1,$2,$3 WHERE NOT EXISTS (SELECT 1 FROM penalty_reviews WHERE user_id=$1 AND status='open')`,
      [userId, penaltyId, now()],
    );
}

/**
 * Confirma o cancelamento. O cliente envia o valor de multa que viu na prévia e a versão da política; se a
 * situação mudou (ex.: o profissional saiu para o deslocamento), devolve 409 para nova confirmação.
 * Cancelar um contrato não afeta os demais contratos do mesmo pedido (R13).
 */
export async function cancelContract(actor: Actor, contractId: string, input: { reason: string; expectedPenaltyCents: number; policyVersion?: number }) {
  const reason = input.reason.trim();
  if (reason.length < 3) throw invalid('Informe o motivo do cancelamento.');
  return tx(async () => {
    const { c, unit, role } = await load(actor, contractId, true);
    const p = evaluateCancellation(c, unit, role, now());
    if (p.outcome === 'not_allowed') throw conflict('bad_state', p.explanation);
    if (p.outcome === 'requires_support') throw rule('requires_support', p.explanation);
    if (input.policyVersion != null && input.policyVersion !== p.policyVersion) throw conflict('preview_changed', 'A política aplicável mudou. Revise antes de confirmar.');
    if (p.penaltyCents !== input.expectedPenaltyCents) throw conflict('preview_changed', 'As condições do cancelamento mudaram. Revise os valores antes de confirmar.');
    await closeWithOutcome(actor.id, c, unit, p, 'cancellation', reason);
    const other = role === 'client' ? c.worker_id : c.client_id;
    await notify(other, 'contract.cancelled', 'Contrato cancelado', 'A outra parte cancelou o contrato. Veja os detalhes.', `/contratos/${c.id}`, `contract.cancelled:${c.id}`);
    return p;
  });
}

/**
 * R26 — ausência: exige contato no chat e espera registrada (15 min por padrão) contada desse contato,
 * que para serviços agendados só vale a partir do horário marcado. A multa pode ser analisada/anulada pelo suporte.
 */
export async function reportNoShow(actor: Actor, contractId: string, reasonRaw: string) {
  const reason = reasonRaw.trim() || 'Ausência registrada';
  return tx(async () => {
    const { c, unit, role } = await load(actor, contractId, true);
    if (c.status !== 'confirmed' && c.status !== 'en_route') throw conflict('bad_state', 'A ausência só pode ser registrada antes do início do serviço.');
    const pol = c.policy_snapshot;
    const t = now();
    const since = c.kind === 'scheduled' ? c.starts_at : c.confirmed_at ?? c.starts_at;
    const contact = await q1<{ at: Date }>(
      `SELECT min(m.created_at) AS at FROM messages m JOIN conversations cv ON cv.id = m.conversation_id
        WHERE cv.request_id=$1 AND cv.worker_id=$2 AND m.sender_id=$3 AND m.created_at >= $4`,
      [c.request_id, c.worker_id, actor.id, since],
    );
    if (!contact?.at)
      throw rule('no_contact', c.kind === 'scheduled'
        ? 'Antes de registrar ausência, tente contato pelo chat a partir do horário marcado.'
        : 'Antes de registrar ausência, tente contato pelo chat.');
    if (t < addMinutes(contact.at, pol.noShowWaitMinutes))
      throw rule('wait_required', `Aguarde ${pol.noShowWaitMinutes} minutos após o contato no chat para registrar a ausência.`);
    const absent = role === 'client' ? 'worker' : 'client';
    const penalty = penaltyAmount(unit.budget_cents, pol.noShowPenaltyBps, pol.noShowCapCents);
    const base: CancellationPreview = {
      outcome: 'penalty', responsible: absent, penaltyCents: penalty, penaltyBeneficiary: role, settlement: null,
      fundedCents: unit.funded_cents, refundToClientCents: unit.funded_cents, policyVersion: c.policy_version, explanation: '',
    };
    const p = applyPenalty(base, absent, penalty, unit.funded_cents, 'Ausência registrada.');
    await closeWithOutcome(actor.id, c, unit, p, 'no_show', reason);
    const other = role === 'client' ? c.worker_id : c.client_id;
    await notify(other, 'contract.no_show', 'Ausência registrada', 'A outra parte registrou sua ausência. Se discordar, fale com o suporte.', `/contratos/${c.id}`, `contract.no_show:${c.id}`);
    return p;
  });
}

// ───────────── Suporte ─────────────

/** R31: multa anulada não conta. Audita motivo; estorna o débito ainda registrado referenciando o lançamento original. */
export async function voidPenalty(actor: Actor, penaltyId: string, reasonRaw: string) {
  if (!actor.isSupport) throw forbidden();
  const reason = reasonRaw.trim();
  if (reason.length < 10) throw invalid('Informe a justificativa da anulação.');
  if (!isUuid(penaltyId)) throw notFound();
  await tx(async () => {
    const p = await q1<{ id: string; user_id: string; amount_cents: number; status: string; settlement: string; contract_id: string }>(
      'SELECT * FROM penalties WHERE id = $1 FOR UPDATE', [penaltyId],
    );
    if (!p) throw notFound();
    if (p.status !== 'valid') throw conflict('bad_state', 'Esta multa já foi anulada.');
    await q(`UPDATE penalties SET status='voided', void_reason=$2, voided_by=$3, voided_at=$4 WHERE id=$1`, [p.id, reason, actor.id, now()]);
    let financialNote = 'Sem movimentação a estornar.';
    if (p.settlement === 'debt') {
      const original = await findTx(`penalty_debt:${p.id}`);
      await post({
        kind: 'penalty_void', key: `penalty_void:${p.id}`, refType: 'penalty', refId: p.id, reversesTxId: original ?? undefined, memo: 'Estorno de multa anulada',
        legs: [
          { account: await account('penalty_debt', { userId: p.user_id }), amount: p.amount_cents },
          { account: await account('penalty_receivable'), amount: -p.amount_cents },
        ],
      });
      financialNote = 'Débito estornado.';
    } else {
      // dinheiro já transferido à outra parte não é revertido automaticamente; exige decisão financeira própria
      financialNote = 'Compensação já paga com valor retido: ajuste financeiro, se cabível, deve ser decidido separadamente.';
    }
    await audit(actor.id, 'penalty.void', 'penalty', p.id, reason, { amountCents: p.amount_cents, settlement: p.settlement, financialNote });
    await notify(p.user_id, 'penalty.voided', 'Multa anulada', 'O suporte anulou uma multa registrada em sua conta.', `/contratos/${p.contract_id}`, `penalty.voided:${p.id}`);
  });
}

/** Encerra a análise de multas. Bloqueio só por decisão humana explícita, com justificativa auditada. */
export async function closePenaltyReview(actor: Actor, reviewId: string, decision: 'no_action' | 'blocked', noteRaw: string) {
  if (!actor.isSupport) throw forbidden();
  const note = noteRaw.trim();
  if (note.length < 10) throw invalid('Informe a justificativa da decisão.');
  if (decision !== 'no_action' && decision !== 'blocked') throw invalid('Decisão inválida.');
  await tx(async () => {
    const r = await q1<{ id: string; user_id: string; status: string }>('SELECT * FROM penalty_reviews WHERE id = $1 FOR UPDATE', [reviewId]);
    if (!r) throw notFound();
    if (r.status !== 'open') throw conflict('bad_state', 'Esta análise já foi encerrada.');
    await q(`UPDATE penalty_reviews SET status='closed', decision=$2, note=$3, closed_by=$4, closed_at=$5 WHERE id=$1`, [r.id, decision, note, actor.id, now()]);
    if (decision === 'blocked') {
      await q(`UPDATE users SET status='blocked', updated_at=$2 WHERE id=$1`, [r.user_id, now()]);
      await q('DELETE FROM sessions WHERE user_id=$1', [r.user_id]);
    }
    await audit(actor.id, `penalty_review.${decision}`, 'user', r.user_id, note, { reviewId: r.id });
  });
}

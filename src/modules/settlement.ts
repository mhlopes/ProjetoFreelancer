import { q, q1, tx } from '@/lib/db';
import { now, addHours } from '@/lib/clock';
import { bpsOf, hourlyAmount } from '@/lib/money';
import { conflict, forbidden, invalid, notFound, rule } from '@/lib/errors';
import { audit, isUuid, notify, type Actor } from './core';
import { closeContractAsCancelled, type Contract, type WorkUnit } from './contracts';
import { account, post } from './ledger';

async function lockUnit(unitId: string): Promise<{ unit: WorkUnit; contract: Contract }> {
  if (!isUuid(unitId)) throw notFound();
  const pre = await q1<{ contract_id: string }>('SELECT contract_id FROM work_units WHERE id = $1', [unitId]);
  if (!pre) throw notFound();
  // ordem de trava estável: contrato, depois unidade
  const contract = (await q1<Contract>('SELECT * FROM contracts WHERE id = $1 FOR UPDATE', [pre.contract_id]))!;
  const unit = (await q1<WorkUnit>('SELECT * FROM work_units WHERE id = $1 FOR UPDATE', [unitId]))!;
  return { unit, contract };
}

/** Serviço encerrado pelo trabalhador: o horário deixa de bloquear a agenda (ele pode aceitar outro chamado). */
async function releaseSchedule(contractId: string) {
  await q(`UPDATE schedule_reservations SET state='released' WHERE contract_id=$1 AND state='confirmed'`, [contractId]);
}

function assertParty(actor: Actor, c: Contract): 'client' | 'worker' {
  if (c.client_id === actor.id) return 'client';
  if (c.worker_id === actor.id) return 'worker';
  throw notFound();
}

/**
 * Valor devido ao trabalhador pela unidade, antes da comissão. Nunca excede o valor financiado:
 * horas acima do teto não geram débito automático (exigem acordo e financiamento, ou suporte).
 */
export function amountDue(c: Pick<Contract, 'billing_unit' | 'amount_cents'>, u: Pick<WorkUnit, 'funded_cents' | 'reported_minutes'>) {
  if (c.billing_unit === 'fixed') return { dueCents: u.funded_cents, excessCents: 0 };
  const computed = hourlyAmount(c.amount_cents, u.reported_minutes ?? 0);
  return { dueCents: Math.min(computed, u.funded_cents), excessCents: Math.max(0, computed - u.funded_cents) };
}

/** Registro de horas pelo trabalhador (contratos por hora). Minutos inteiros. */
export async function addWorkLog(actor: Actor, unitId: string, input: { date: string; minutes: number; note?: string }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw invalid('Data inválida.');
  if (!Number.isInteger(input.minutes) || input.minutes < 1 || input.minutes > 1440) throw invalid('Minutos inválidos.');
  await tx(async () => {
    const { unit, contract } = await lockUnit(unitId);
    if (assertParty(actor, contract) !== 'worker') throw forbidden('Somente o profissional registra horas.');
    if (contract.billing_unit !== 'hour') throw rule('not_hourly', 'Este contrato não é por hora.');
    if (contract.status !== 'in_progress') throw conflict('bad_state', 'Registre horas com o serviço em andamento.');
    await q('INSERT INTO work_logs (unit_id, author_id, work_date, minutes, note, created_at) VALUES ($1,$2,$3,$4,$5,$6)', [
      unit.id, actor.id, input.date, input.minutes, (input.note ?? '').slice(0, 500), now(),
    ]);
  });
}

/**
 * Somente o trabalhador vinculado solicita conclusão, com resumo do executado.
 * O relógio de 24h começa aqui, no servidor: deadline = submitted_at + 24h.
 */
export async function submitCompletion(actor: Actor, unitId: string, input: { summary: string }) {
  const summary = input.summary.trim();
  if (summary.length < 10) throw invalid('Descreva o que foi executado (mínimo de 10 caracteres).');
  await tx(async () => {
    const { unit, contract } = await lockUnit(unitId);
    if (assertParty(actor, contract) !== 'worker') throw forbidden('Somente o profissional contratado solicita a conclusão.');
    if (contract.status !== 'in_progress') throw conflict('bad_state', 'A conclusão só pode ser solicitada com o serviço em andamento.');
    const t = now();
    if (contract.payment_mode === 'cash') {
      if (unit.status !== 'external_due') throw conflict('bad_state', 'Conclusão já registrada.');
      await q('UPDATE work_units SET summary=$2, submitted_at=$3, updated_at=$3 WHERE id=$1', [unit.id, summary, t]);
      await q(`UPDATE contracts SET status='completion_requested', updated_at=$2 WHERE id=$1`, [contract.id, t]);
      await releaseSchedule(contract.id);
      await notify(contract.client_id, 'unit.submitted', 'Profissional registrou a conclusão',
        'Confirme a conclusão e o pagamento em dinheiro feito diretamente ao profissional.', `/contratos/${contract.id}`, `unit.submitted:${unit.id}`);
      return;
    }
    if (unit.status !== 'in_progress') throw conflict('bad_state', 'Esta unidade não está em execução.');
    let minutes: number | null = null;
    if (contract.billing_unit === 'hour') {
      const s = await q1<{ m: number }>('SELECT COALESCE(sum(minutes),0)::int AS m FROM work_logs WHERE unit_id=$1', [unit.id]);
      if (!s!.m) throw rule('no_logs', 'Registre as horas trabalhadas antes de solicitar a conclusão.');
      minutes = s!.m;
    }
    const deadline = addHours(t, contract.policy_snapshot.completionConfirmationHours);
    await q(`UPDATE work_units SET status='submitted', summary=$2, reported_minutes=$3, submitted_at=$4, deadline_at=$5, updated_at=$4 WHERE id=$1`, [
      unit.id, summary, minutes, t, deadline,
    ]);
    await q(`UPDATE contracts SET status='completion_requested', updated_at=$2 WHERE id=$1`, [contract.id, t]);
    await releaseSchedule(contract.id);
    await notify(contract.client_id, 'unit.submitted', 'Profissional registrou a conclusão',
      `Confirme ou conteste em até ${contract.policy_snapshot.completionConfirmationHours}h. Sem resposta, o pagamento é liberado automaticamente.`,
      `/contratos/${contract.id}`, `unit.submitted:${unit.id}`);
  });
}

export type SettleResult = { released: boolean; alreadyReleased?: boolean; skipped?: string };

/**
 * Função transacional ÚNICA de liquidação, usada pela aprovação explícita, pelo aceite de correção e pelo job de 24h.
 * Revalida estado e prazo sob trava (não confia em quem chamou) e é idempotente: uma só liberação por unidade.
 */
export async function settleUnit(unitId: string, trigger: 'manual' | 'auto' | 'correction'): Promise<SettleResult> {
  return tx(async () => {
    const { unit, contract } = await lockUnit(unitId);
    if (unit.status === 'released') return { released: false, alreadyReleased: true };
    if (unit.status !== 'submitted') {
      if (trigger === 'auto') return { released: false, skipped: unit.status };
      throw conflict('bad_state', unit.status === 'disputed' ? 'Esta parcela está contestada e bloqueada.' : 'Esta parcela não está aguardando confirmação.');
    }
    const t = now();
    if (trigger === 'auto') {
      // 24h completas; contestação recebida até o prazo (inclusive) tem prioridade
      if (!unit.deadline_at || t <= unit.deadline_at) return { released: false, skipped: 'before_deadline' };
      // alteração material pendente impede liquidação automática
      if (unit.pending_correction_minutes != null) return { released: false, skipped: 'pending_change' };
    }
    if (trigger === 'manual' && unit.pending_correction_minutes != null)
      throw conflict('pending_change', 'Há uma correção de horas aguardando resposta do profissional.');

    const { dueCents } = amountDue(contract, unit);
    await releaseFunds(contract, unit, dueCents, `release:${unit.id}`, 'release');
    await q(`UPDATE contracts SET status='completed', completed_at=$2, updated_at=$2 WHERE id=$1`, [contract.id, t]);
    const how = trigger === 'auto' ? 'liberado automaticamente após o prazo' : 'liberado após confirmação';
    await notify(contract.worker_id, 'unit.released', 'Pagamento liberado', `Valor ${how}. Avalie o contratante.`, `/contratos/${contract.id}`, `unit.released:${unit.id}:worker`);
    await notify(contract.client_id, 'unit.released', 'Serviço concluído', `Pagamento ${how}. Avalie o profissional.`, `/contratos/${contract.id}`, `unit.released:${unit.id}:client`);
    return { released: true };
  });
}

/**
 * Distribui o valor retido da unidade: bruto ao trabalhador (menos comissão do snapshot), restante de volta à
 * carteira do contratante. Só movimenta o que foi financiado. Chamado sob transação e trava da unidade.
 */
async function releaseFunds(contract: Contract, unit: WorkUnit, grossWorkerCents: number, key: string, kind: string) {
  const funded = unit.funded_cents;
  if (grossWorkerCents < 0 || grossWorkerCents > funded) throw new Error('valor de liberação fora do financiado');
  // comissão da política vigente NA CONTRATAÇÃO, nunca da configuração atual
  const fee = bpsOf(grossWorkerCents, contract.policy_snapshot.platformFeeBps);
  const refund = funded - grossWorkerCents;
  await post({
    kind, key, refType: 'unit', refId: unit.id, memo: 'Liquidação da unidade',
    legs: [
      { account: await account('unit_reserve', { unitId: unit.id }), amount: -funded },
      { account: await account('worker_earnings', { userId: contract.worker_id }), amount: grossWorkerCents - fee },
      { account: await account('fee_revenue'), amount: fee },
      { account: await account('client_wallet', { userId: contract.client_id }), amount: refund },
    ],
  });
  if (refund > 0)
    await q(
      `INSERT INTO refunds (unit_id, user_id, amount_cents, destination, reason, idempotency_key, created_at)
       VALUES ($1,$2,$3,'wallet',$4,$5,$6) ON CONFLICT (idempotency_key) DO NOTHING`,
      [unit.id, contract.client_id, refund, 'Diferença não utilizada da reserva', `refund:${key}`, now()],
    );
  await q(
    `UPDATE work_units SET status=$2, released_at=$3, released_worker_cents=$4, released_fee_cents=$5, refunded_cents=$6, updated_at=$3 WHERE id=$1`,
    [unit.id, kind === 'release' ? 'released' : 'resolved', now(), grossWorkerCents - fee, fee, refund],
  );
}

/** Contratante confirma a conclusão antes do prazo. */
export async function approveUnit(actor: Actor, unitId: string): Promise<SettleResult> {
  if (!isUuid(unitId)) throw notFound();
  const c = await q1<{ client_id: string; worker_id: string }>(
    'SELECT k.client_id, k.worker_id FROM work_units u JOIN contracts k ON k.id = u.contract_id WHERE u.id = $1', [unitId],
  );
  if (!c || (c.client_id !== actor.id && c.worker_id !== actor.id)) throw notFound();
  if (c.client_id !== actor.id) throw forbidden('Somente o contratante confirma a conclusão.');
  return settleUnit(unitId, 'manual');
}

/** Job das 24h: tenta liquidar cada unidade vencida; cada uma revalida tudo sob trava. */
export async function releaseDueUnits(): Promise<number> {
  const due = await q<{ id: string }>(`SELECT id FROM work_units WHERE status='submitted' AND deadline_at < $1 ORDER BY deadline_at LIMIT 100`, [now()]);
  let n = 0;
  for (const u of due) {
    try {
      if ((await settleUnit(u.id, 'auto')).released) n++;
    } catch (e) {
      console.error('[jobs] falha ao liquidar unidade', u.id, e);
    }
  }
  return n;
}

/** Job: aviso antes do prazo (R18). */
export async function remindDeadlines(): Promise<number> {
  const rows = await q<{ id: string; contract_id: string; client_id: string }>(
    `SELECT u.id, u.contract_id, k.client_id FROM work_units u JOIN contracts k ON k.id = u.contract_id
      WHERE u.status='submitted' AND u.deadline_at > $1 AND u.deadline_at <= $2`,
    [now(), addHours(now(), 3)],
  );
  for (const r of rows)
    await notify(r.client_id, 'unit.deadline', 'Prazo de confirmação terminando',
      'Faltam menos de 3h para confirmar ou contestar a conclusão. Depois disso o pagamento é liberado.', `/contratos/${r.contract_id}`, `unit.deadline:${r.id}`);
  return rows.length;
}

// ───────────── Correção de horas (contratante corrige; trabalhador responde) ─────────────

export async function proposeCorrection(actor: Actor, unitId: string, minutes: number) {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 100_000) throw invalid('Informe os minutos corretos.');
  await tx(async () => {
    const { unit, contract } = await lockUnit(unitId);
    if (assertParty(actor, contract) !== 'client') throw forbidden('Somente o contratante corrige as horas.');
    if (contract.billing_unit !== 'hour') throw rule('not_hourly', 'Este contrato não é por hora.');
    if (unit.status !== 'submitted') throw conflict('bad_state', 'Esta parcela não está aguardando confirmação.');
    if (now() > unit.deadline_at!) throw conflict('deadline_passed', 'O prazo para confirmar ou contestar terminou.');
    if (minutes === unit.reported_minutes) throw invalid('O valor informado é igual ao registrado. Use "Confirmar".');
    await q('UPDATE work_units SET pending_correction_minutes=$2, updated_at=$3 WHERE id=$1', [unit.id, minutes, now()]);
    await notify(contract.worker_id, 'unit.correction', 'Contratante corrigiu as horas', 'Aceite a correção ou recuse para acionar o suporte.',
      `/contratos/${contract.id}`, `unit.correction:${unit.id}:${minutes}`);
  });
}

export async function respondCorrection(actor: Actor, unitId: string, accept: boolean) {
  await tx(async () => {
    const { unit, contract } = await lockUnit(unitId);
    if (assertParty(actor, contract) !== 'worker') throw forbidden('Somente o profissional responde à correção.');
    if (unit.status !== 'submitted' || unit.pending_correction_minutes == null) throw conflict('bad_state', 'Não há correção pendente.');
    if (accept) {
      // ambos aprovam a mesma quantidade: liquida imediatamente
      await q('UPDATE work_units SET reported_minutes=$2, pending_correction_minutes=NULL, updated_at=$3 WHERE id=$1', [unit.id, unit.pending_correction_minutes, now()]);
      await settleUnit(unit.id, 'correction');
    } else {
      await openDisputeLocked(actor, unit, contract, `Correção de horas recusada pelo profissional (registrado: ${unit.reported_minutes} min; correção: ${unit.pending_correction_minutes} min).`);
    }
  });
}

// ───────────── Disputas ─────────────

async function openDisputeLocked(actor: Actor, unit: WorkUnit, contract: Contract, reason: string): Promise<string> {
  const t = now();
  const d = await q1<{ id: string }>(
    'INSERT INTO disputes (unit_id, contract_id, opened_by, reason, created_at) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [unit.id, contract.id, actor.id, reason, t],
  );
  await q(`UPDATE work_units SET status='disputed', status_before_dispute=$2, updated_at=$3 WHERE id=$1`, [unit.id, unit.status, t]);
  await q('INSERT INTO dispute_events (dispute_id, actor_id, kind, note, created_at) VALUES ($1,$2,$3,$4,$5)', [d!.id, actor.id, 'opened', reason, t]);
  const other = contract.client_id === actor.id ? contract.worker_id : contract.client_id;
  await notify(other, 'dispute.opened', 'Contestação aberta', 'A outra parte abriu uma contestação. O valor fica bloqueado até a análise do suporte.',
    `/contratos/${contract.id}`, `dispute.opened:${d!.id}`);
  return d!.id;
}

/**
 * Contestação por um participante: bloqueia a parcela antes da liberação. Recebida até o prazo (inclusive) tem
 * prioridade sobre a liberação automática; depois do prazo a liberação prevalece. É entidade paralela: o estado
 * do contrato não é apagado.
 */
export async function openDispute(actor: Actor, unitId: string, reasonRaw: string): Promise<string> {
  const reason = reasonRaw.trim();
  if (reason.length < 10) throw invalid('Explique o motivo da contestação (mínimo de 10 caracteres).');
  return tx(async () => {
    const { unit, contract } = await lockUnit(unitId);
    assertParty(actor, contract);
    if (!['funded', 'in_progress', 'submitted'].includes(unit.status))
      throw conflict('bad_state', unit.status === 'released' ? 'O pagamento desta parcela já foi liberado.' : 'Esta parcela não pode ser contestada neste estado.');
    if (unit.status === 'submitted' && now() > unit.deadline_at!) throw conflict('deadline_passed', 'O prazo para contestar terminou.');
    return openDisputeLocked(actor, unit, contract, reason);
  });
}

/**
 * Suporte resolve a disputa: libera, reembolsa ou divide. Movimenta apenas o valor financiado DESTA unidade;
 * exige justificativa e fica auditado.
 */
export async function resolveDispute(
  actor: Actor,
  disputeId: string,
  input: { resolution: 'release' | 'refund' | 'partial'; workerCents?: number; note: string },
) {
  if (!actor.isSupport) throw forbidden();
  if (input.note.trim().length < 10) throw invalid('Informe a justificativa da decisão.');
  if (!['release', 'refund', 'partial'].includes(input.resolution)) throw invalid('Resolução inválida.');
  if (!isUuid(disputeId)) throw notFound();
  await tx(async () => {
    const pre = await q1<{ unit_id: string }>('SELECT unit_id FROM disputes WHERE id = $1', [disputeId]);
    if (!pre) throw notFound();
    const { unit, contract } = await lockUnit(pre.unit_id);
    const d = await q1<{ id: string; status: string }>('SELECT id, status FROM disputes WHERE id = $1 FOR UPDATE', [disputeId]);
    if (d!.status !== 'open' || unit.status !== 'disputed') throw conflict('bad_state', 'Esta disputa já foi resolvida.');
    let gross: number;
    if (input.resolution === 'refund') gross = 0;
    else if (input.resolution === 'release') gross = unit.reported_minutes != null || contract.billing_unit === 'fixed' ? amountDue(contract, unit).dueCents : unit.funded_cents;
    else {
      gross = input.workerCents ?? -1;
      if (!Number.isSafeInteger(gross) || gross <= 0 || gross >= unit.funded_cents)
        throw invalid('Na divisão, o valor do profissional deve ser maior que zero e menor que o valor retido.');
    }
    const t = now();
    await releaseFunds(contract, unit, gross, `dispute:${d!.id}`, 'dispute_resolution');
    await q(`UPDATE disputes SET status='resolved', resolution=$2, worker_cents=$3, resolved_by=$4, resolution_note=$5, resolved_at=$6 WHERE id=$1`, [
      d!.id, input.resolution, gross, actor.id, input.note.trim(), t,
    ]);
    await q('INSERT INTO dispute_events (dispute_id, actor_id, kind, note, created_at) VALUES ($1,$2,$3,$4,$5)', [d!.id, actor.id, `resolved:${input.resolution}`, input.note.trim(), t]);
    if (gross > 0) {
      await q(`UPDATE contracts SET status='completed', completed_at=$2, updated_at=$2 WHERE id=$1`, [contract.id, t]);
      await releaseSchedule(contract.id);
    }
    else await closeContractAsCancelled(contract, { by: actor.id, responsible: 'none', kind: 'dispute_refund', reason: 'Disputa resolvida com reembolso integral.' });
    await audit(actor.id, 'dispute.resolve', 'dispute', d!.id, input.note.trim(), { resolution: input.resolution, workerGrossCents: gross, fundedCents: unit.funded_cents });
    for (const uid of [contract.client_id, contract.worker_id])
      await notify(uid, 'dispute.resolved', 'Disputa resolvida', 'O suporte concluiu a análise. Veja o resultado no contrato.', `/contratos/${contract.id}`, `dispute.resolved:${d!.id}:${uid}`);
  });
}

// ───────────── Dinheiro físico ─────────────

/**
 * Pagamento em espécie é externo: cada parte confirma de forma independente. Quando ambas confirmam conclusão e
 * pagamento, o contrato conclui e pode ser avaliado. NENHUM lançamento no ledger e nenhuma comissão de serviço.
 */
export async function confirmCash(actor: Actor, contractId: string) {
  if (!isUuid(contractId)) throw notFound();
  await tx(async () => {
    const c = await q1<Contract>('SELECT * FROM contracts WHERE id = $1 FOR UPDATE', [contractId]);
    if (!c) throw notFound();
    const role = assertParty(actor, c);
    if (c.payment_mode !== 'cash') throw rule('not_cash', 'Este contrato não é em dinheiro físico.');
    if (c.status !== 'completion_requested') throw conflict('bad_state', 'A confirmação fica disponível após o profissional registrar a conclusão.');
    const t = now();
    await q('INSERT INTO cash_confirmations (contract_id, user_id, confirmed_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [c.id, actor.id, t]);
    const n = await q1<{ c: number }>('SELECT count(*)::int AS c FROM cash_confirmations WHERE contract_id=$1', [c.id]);
    if (n!.c >= 2) {
      await q(`UPDATE work_units SET status='external_confirmed', updated_at=$2 WHERE contract_id=$1 AND status IN ('external_due','external_reported')`, [c.id, t]);
      await q(`UPDATE contracts SET status='completed', completed_at=$2, updated_at=$2 WHERE id=$1`, [c.id, t]);
      for (const uid of [c.client_id, c.worker_id])
        await notify(uid, 'contract.completed', 'Serviço concluído', 'Conclusão e pagamento em dinheiro confirmados pelas duas partes. Avalie a experiência.',
          `/contratos/${c.id}`, `contract.completed:${c.id}:${uid}`);
    } else {
      if (role === 'worker') await q(`UPDATE work_units SET status='external_reported', updated_at=$2 WHERE contract_id=$1 AND status='external_due'`, [c.id, t]);
      const other = role === 'client' ? c.worker_id : c.client_id;
      await notify(other, 'cash.confirmed', 'Confirmação pendente', 'A outra parte confirmou a conclusão e o pagamento em dinheiro. Falta a sua confirmação.',
        `/contratos/${c.id}`, `cash.confirmed:${c.id}:${actor.id}`);
    }
  });
}

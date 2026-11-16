import { beforeEach, describe, expect, it } from 'vitest';
import { q, q1 } from '@/lib/db';
import { config } from '@/lib/config';
import { reconciliation } from '@/modules/admin';
import { cancelContract, closePenaltyReview, previewCancellation, reportNoShow, voidPenalty } from '@/modules/cancellations';
import { openConversationAsWorker, postMessage } from '@/modules/chat';
import { approveProposal, expireFundingHolds, markDeparture, startWork } from '@/modules/contracts';
import { getMockGateway } from '@/modules/gateway';
import { ledgerHealth, post, account } from '@/modules/ledger';
import { createContractPayment, handleWebhook, simulatePaymentOutcome, simulateProviderObject, deliverDelayedMockEvents } from '@/modules/payments';
import { reputation } from '@/modules/profiles';
import { submitProposal } from '@/modules/proposals';
import { getReviewState, submitReview } from '@/modules/reviews';
import {
  addWorkLog, approveUnit, confirmCash, openDispute, proposeCorrection, releaseDueUnits, resolveDispute, respondCorrection, submitCompletion,
} from '@/modules/settlement';
import { getWallet, listWalletEntries, requestPayout } from '@/modules/wallet';
import {
  advance, balance, count, currentVersionId, failure, freshDb, fundedAndSubmitted, hire, mkRequest, mkUser, mkWorker, pay, status,
} from './helpers';

beforeEach(freshDb);

const setup = async () => ({ cliente: await mkUser('Cliente'), worker: await mkWorker('Trabalhador') });

describe('Cenário: Pagamento duplicado', () => {
  it('o mesmo evento assinado recebido duas vezes registra 12000 uma única vez', async () => {
    const { cliente, worker } = await setup();
    const h = await hire(cliente, worker, await mkRequest(cliente));
    await pay(cliente, h.contractId, 'duplicate');
    expect(await balance('unit_reserve', { unitId: h.unitId })).toBe(12000);
    expect(await balance('provider_clearing')).toBe(-12000);
    expect(await count(`ledger_transactions WHERE kind='payment'`)).toBe(1);
    expect(await count('provider_events')).toBe(1);
    expect(await status('contracts', h.contractId)).toBe('confirmed');
  });

  it('redirecionamento do navegador não prova pagamento: criar a cobrança não confirma nada', async () => {
    const { cliente, worker } = await setup();
    const h = await hire(cliente, worker, await mkRequest(cliente));
    await createContractPayment(cliente, h.contractId, { method: 'pix' });
    expect(await status('contracts', h.contractId)).toBe('awaiting_funding');
    expect(await count('ledger_entries')).toBe(0);
  });

  it('webhook com assinatura inválida ou valor divergente é recusado', async () => {
    const { cliente, worker } = await setup();
    const h = await hire(cliente, worker, await mkRequest(cliente));
    const p = await createContractPayment(cliente, h.contractId, { method: 'pix' });
    const gw = getMockGateway();
    const forged = JSON.stringify({ id: 'evt_forjado', type: 'payment.confirmed', data: { providerRef: p.provider_ref, amountCents: 12000, currency: 'BRL' } });
    expect(await failure(handleWebhook('mock', forged, 'assinatura-errada'))).toMatchObject({ status: 401 });
    expect(await failure(handleWebhook('mock', forged, null))).toMatchObject({ status: 401 });
    // assinatura válida, mas valor diferente da cobrança: fica na fila de falhas, sem lançamento
    const wrong = gw.sign({ id: 'evt_valor_errado', type: 'payment.confirmed', data: { providerRef: p.provider_ref, amountCents: 1, currency: 'BRL' } });
    expect((await handleWebhook('mock', wrong.rawBody, wrong.signature)).status).toBe('failed');
    expect(await count('ledger_entries')).toBe(0);
    expect(await status('contracts', h.contractId)).toBe('awaiting_funding');
    expect(await count(`provider_events WHERE status='failed'`)).toBe(1);
  });

  it('pagamento falho mantém aguardando; atrasado confirma quando o evento chega', async () => {
    const { cliente, worker } = await setup();
    const h = await hire(cliente, worker, await mkRequest(cliente));
    await pay(cliente, h.contractId, 'failure');
    expect(await status('contracts', h.contractId)).toBe('awaiting_funding');
    await pay(cliente, h.contractId, 'delay');
    expect(await status('contracts', h.contractId)).toBe('awaiting_funding');
    expect(await deliverDelayedMockEvents()).toBe(0);
    advance(3);
    expect(await deliverDelayedMockEvents()).toBe(1);
    expect(await status('contracts', h.contractId)).toBe('confirmed');
  });

  it('terceiro não paga nem simula pagamento alheio', async () => {
    const { cliente, worker } = await setup();
    const outro = await mkUser('Outro');
    const h = await hire(cliente, worker, await mkRequest(cliente));
    expect(await failure(createContractPayment(outro, h.contractId, { method: 'pix' }))).toMatchObject({ status: 404 });
    expect(await failure(createContractPayment(worker, h.contractId, { method: 'pix' }))).toMatchObject({ status: 403 });
    const p = await createContractPayment(cliente, h.contractId, { method: 'pix' });
    expect(await failure(simulatePaymentOutcome(outro, p.id, 'success'))).toMatchObject({ status: 404 });
  });
});

describe('Cenário: Conclusão automática', () => {
  it('23h59 não libera; após 24h libera o valor autorizado uma única vez', async () => {
    const { cliente, worker } = await setup();
    const h = await fundedAndSubmitted(cliente, worker);
    advance(23 * 60 + 59);
    expect(await releaseDueUnits()).toBe(0);
    expect(await status('work_units', h.unitId)).toBe('submitted');
    advance(1); // exatamente 24h: contestação até o prazo (inclusive) ainda tem prioridade
    expect(await releaseDueUnits()).toBe(0);
    advance(1);
    expect(await releaseDueUnits()).toBe(1);
    expect(await releaseDueUnits()).toBe(0);
    expect(await status('work_units', h.unitId)).toBe('released');
    expect(await status('contracts', h.contractId)).toBe('completed');
    expect(await balance('worker_earnings', { userId: worker.id })).toBe(12000);
    expect(await balance('unit_reserve', { unitId: h.unitId })).toBe(0);
    expect(await count(`ledger_transactions WHERE kind='release'`)).toBe(1);
  });

  it('contratante pode confirmar antes; somente ele confirma', async () => {
    const { cliente, worker } = await setup();
    const h = await fundedAndSubmitted(cliente, worker);
    expect(await failure(approveUnit(worker, h.unitId))).toMatchObject({ status: 403 });
    expect(await failure(approveUnit(await mkUser('Outro'), h.unitId))).toMatchObject({ status: 404 });
    expect(await approveUnit(cliente, h.unitId)).toMatchObject({ released: true });
    expect(await approveUnit(cliente, h.unitId)).toMatchObject({ released: false, alreadyReleased: true });
    expect(await balance('worker_earnings', { userId: worker.id })).toBe(12000);
  });

  it('somente o trabalhador vinculado solicita conclusão, e só de serviço iniciado', async () => {
    const { cliente, worker } = await setup();
    const h = await hire(cliente, worker, await mkRequest(cliente));
    await pay(cliente, h.contractId);
    expect(await failure(submitCompletion(worker, h.unitId, { summary: 'Feito tudo certinho.' }))).toMatchObject({ status: 409 });
    await startWork(worker, h.contractId);
    expect(await failure(submitCompletion(cliente, h.unitId, { summary: 'Feito tudo certinho.' }))).toMatchObject({ status: 403 });
    expect(await failure(submitCompletion(worker, h.unitId, { summary: 'ok' }))).toMatchObject({ status: 400 });
  });

  it('registrar a conclusão libera a agenda: o trabalhador pode aceitar outro chamado em seguida', async () => {
    const { cliente, worker } = await setup();
    const outro = await mkUser('Outro Cliente');
    await fundedAndSubmitted(cliente, worker); // janela estimada de 2h ainda não terminou
    advance(10);
    const id2 = await mkRequest(outro);
    expect(await count('request_dispatches WHERE request_id=$1 AND worker_id=$2', [id2, worker.id])).toBe(1);
    const h2 = await hire(outro, worker, id2);
    await pay(outro, h2.contractId);
    expect(await status('contracts', h2.contractId)).toBe('confirmed');
  });

  it('serviço não inicia sem pagamento confirmado', async () => {
    const { cliente, worker } = await setup();
    const h = await hire(cliente, worker, await mkRequest(cliente));
    expect(await failure(startWork(worker, h.contractId))).toMatchObject({ status: 409 });
  });

  it('comissão usa o snapshot da contratação, não a configuração alterada depois', async () => {
    const { cliente, worker } = await setup();
    config.platformFeeBps = 1000; // taxa SINTÉTICA de teste
    try {
      const h = await fundedAndSubmitted(cliente, worker);
      config.platformFeeBps = 5000;
      await approveUnit(cliente, h.unitId);
      expect(await balance('worker_earnings', { userId: worker.id })).toBe(10800);
      expect(await balance('fee_revenue')).toBe(1200);
    } finally {
      config.platformFeeBps = null;
    }
  });
});

describe('Cenário: Contestação dentro do prazo', () => {
  it('contestação às 23h bloqueia a parcela e o job das 24h não libera', async () => {
    const { cliente, worker } = await setup();
    const h = await fundedAndSubmitted(cliente, worker);
    advance(23 * 60);
    await openDispute(cliente, h.unitId, 'O serviço não foi concluído como combinado.');
    expect(await status('work_units', h.unitId)).toBe('disputed');
    advance(120);
    expect(await releaseDueUnits()).toBe(0);
    expect(await failure(approveUnit(cliente, h.unitId))).toMatchObject({ status: 409 });
    expect(await balance('worker_earnings', { userId: worker.id })).toBe(0);
    expect(await balance('unit_reserve', { unitId: h.unitId })).toBe(12000);
    expect(await status('contracts', h.contractId)).toBe('completion_requested'); // disputa não apaga o estado do contrato
  });

  it('depois do prazo a liberação prevalece sobre a contestação', async () => {
    const { cliente, worker } = await setup();
    const h = await fundedAndSubmitted(cliente, worker);
    advance(24 * 60 + 1);
    expect(await failure(openDispute(cliente, h.unitId, 'Contestação fora do prazo.'))).toMatchObject({ status: 409, code: 'deadline_passed' });
    expect(await releaseDueUnits()).toBe(1);
  });

  it('suporte resolve com divisão; exige justificativa, audita e movimenta só o valor retido', async () => {
    const { cliente, worker } = await setup();
    const suporte = await mkUser('Suporte', { support: true });
    const h = await fundedAndSubmitted(cliente, worker);
    const disputeId = await openDispute(cliente, h.unitId, 'Metade do serviço ficou por fazer.');
    expect(await failure(resolveDispute(cliente, disputeId, { resolution: 'refund', note: 'Decido a meu favor.' }))).toMatchObject({ status: 403 });
    expect(await failure(resolveDispute(suporte, disputeId, { resolution: 'partial', workerCents: 5000, note: 'curto' }))).toMatchObject({ status: 400 });
    expect(await failure(resolveDispute(suporte, disputeId, { resolution: 'partial', workerCents: 12001, note: 'Valor acima do retido.' }))).toMatchObject({ status: 400 });
    await resolveDispute(suporte, disputeId, { resolution: 'partial', workerCents: 5000, note: 'Evidências indicam execução parcial.' });
    expect(await balance('worker_earnings', { userId: worker.id })).toBe(5000);
    expect(await balance('client_wallet', { userId: cliente.id })).toBe(7000);
    expect(await balance('unit_reserve', { unitId: h.unitId })).toBe(0);
    expect(await status('work_units', h.unitId)).toBe('resolved');
    expect(await count(`audit_events WHERE action='dispute.resolve' AND actor_id=$1 AND reason IS NOT NULL`, [suporte.id])).toBe(1);
    expect(await failure(resolveDispute(suporte, disputeId, { resolution: 'refund', note: 'Tentativa repetida de resolução.' }))).toMatchObject({ status: 409 });
  });
});

describe('Cenário: Confirmação manual e job simultâneos', () => {
  it('existe apenas uma transação de liberação', async () => {
    const { cliente, worker } = await setup();
    const h = await fundedAndSubmitted(cliente, worker);
    advance(24 * 60 + 5);
    await Promise.allSettled([approveUnit(cliente, h.unitId), releaseDueUnits(), approveUnit(cliente, h.unitId), releaseDueUnits()]);
    expect(await count(`ledger_transactions WHERE kind='release'`)).toBe(1);
    expect(await balance('worker_earnings', { userId: worker.id })).toBe(12000);
  });

  it('contestação e liberação simultâneas: nunca as duas', async () => {
    const { cliente, worker } = await setup();
    const h = await fundedAndSubmitted(cliente, worker);
    advance(60);
    await Promise.allSettled([openDispute(cliente, h.unitId, 'Contestando ao mesmo tempo da aprovação.'), approveUnit(cliente, h.unitId)]);
    const st = await status('work_units', h.unitId);
    const earned = await balance('worker_earnings', { userId: worker.id });
    expect([['disputed', 0], ['released', 12000]]).toContainEqual([st, earned]);
  });
});

describe('Cenário: Horas menores que estimativa / Adicional sem autorização', () => {
  const hourly = { billingUnit: 'hour' as const, priceCents: 3000, durationMinutes: 240 };

  async function hourlyInProgress() {
    const { cliente, worker } = await setup();
    const h = await hire(cliente, worker, await mkRequest(cliente, hourly));
    const p = await pay(cliente, h.contractId);
    expect(p.amount_cents).toBe(12000); // 3000/h × 240min
    await startWork(worker, h.contractId);
    return { cliente, worker, ...h };
  }

  it('180 minutos aprovados: 9000 ao trabalhador e 3000 de volta à carteira do contratante', async () => {
    const x = await hourlyInProgress();
    expect(await failure(submitCompletion(x.worker, x.unitId, { summary: 'Serviço executado.' }))).toMatchObject({ status: 422, code: 'no_logs' });
    await addWorkLog(x.worker, x.unitId, { date: '2026-11-16', minutes: 120 });
    await addWorkLog(x.worker, x.unitId, { date: '2026-11-16', minutes: 60 });
    expect(await failure(addWorkLog(x.cliente, x.unitId, { date: '2026-11-16', minutes: 60 }))).toMatchObject({ status: 403 });
    await submitCompletion(x.worker, x.unitId, { summary: 'Serviço executado em 3 horas.' });
    await approveUnit(x.cliente, x.unitId);
    expect(await balance('worker_earnings', { userId: x.worker.id })).toBe(9000);
    expect(await balance('client_wallet', { userId: x.cliente.id })).toBe(3000);
    expect(await balance('unit_reserve', { unitId: x.unitId })).toBe(0);
  });

  it('contratante corrige as horas, trabalhador aceita: liquida pelo valor acordado', async () => {
    const x = await hourlyInProgress();
    await addWorkLog(x.worker, x.unitId, { date: '2026-11-16', minutes: 240 });
    await submitCompletion(x.worker, x.unitId, { summary: 'Serviço executado em 4 horas.' });
    await proposeCorrection(x.cliente, x.unitId, 180);
    // alteração pendente impede liquidação automática e aprovação direta
    advance(25 * 60);
    expect(await releaseDueUnits()).toBe(0);
    expect(await failure(approveUnit(x.cliente, x.unitId))).toMatchObject({ status: 409, code: 'pending_change' });
    await respondCorrection(x.worker, x.unitId, true);
    expect(await balance('worker_earnings', { userId: x.worker.id })).toBe(9000);
    expect(await balance('client_wallet', { userId: x.cliente.id })).toBe(3000);
  });

  it('correção recusada vira disputa e bloqueia a parcela', async () => {
    const x = await hourlyInProgress();
    await addWorkLog(x.worker, x.unitId, { date: '2026-11-16', minutes: 240 });
    await submitCompletion(x.worker, x.unitId, { summary: 'Serviço executado em 4 horas.' });
    await proposeCorrection(x.cliente, x.unitId, 60);
    await respondCorrection(x.worker, x.unitId, false);
    expect(await status('work_units', x.unitId)).toBe('disputed');
    expect(await count(`disputes WHERE status='open'`)).toBe(1);
  });

  it('quantidade equivalente a 18000 com teto de 12000: sem débito adicional automático', async () => {
    const x = await hourlyInProgress();
    await addWorkLog(x.worker, x.unitId, { date: '2026-11-16', minutes: 360 });
    await submitCompletion(x.worker, x.unitId, { summary: 'Serviço levou 6 horas.' });
    await approveUnit(x.cliente, x.unitId);
    expect(await balance('worker_earnings', { userId: x.worker.id })).toBe(12000); // só o financiado
    expect(await balance('client_wallet', { userId: x.cliente.id })).toBe(0);
    expect(await count('payments')).toBe(1); // nenhuma cobrança extra criada
    expect(await balance('provider_clearing')).toBe(-12000);
  });
});

describe('Cenário: Pagamento em espécie', () => {
  it('ambos confirmam: contrato concluído e avaliável, sem crédito digital nem comissão', async () => {
    const { cliente, worker } = await setup();
    config.platformFeeBps = 1000;
    try {
      const id = await mkRequest(cliente, { paymentKind: 'cash' });
      const proposalId = await submitProposal(worker, id, {});
      const versionId = await currentVersionId(proposalId);
      expect(await failure(approveProposal(cliente, proposalId, { versionId, paymentMode: 'pix' }))).toMatchObject({ status: 422, code: 'payment_mode' });
      const h = await approveProposal(cliente, proposalId, { versionId, paymentMode: 'cash' });
      expect(h.status).toBe('confirmed'); // sem aguardar pagamento digital
      expect(await failure(createContractPayment(cliente, h.contractId, { method: 'pix' }))).toMatchObject({ status: 409 });
      await startWork(worker, h.contractId);
      expect(await failure(confirmCash(cliente, h.contractId))).toMatchObject({ status: 409 });
      await submitCompletion(worker, h.unitId, { summary: 'Limpeza concluída, recebi em dinheiro.' });
      await confirmCash(worker, h.contractId);
      expect(await status('contracts', h.contractId)).toBe('completion_requested');
      expect(await status('work_units', h.unitId)).toBe('external_reported');
      await confirmCash(worker, h.contractId); // repetir não conta duas vezes
      expect(await status('contracts', h.contractId)).toBe('completion_requested');
      await confirmCash(cliente, h.contractId);
      expect(await status('contracts', h.contractId)).toBe('completed');
      expect(await status('work_units', h.unitId)).toBe('external_confirmed');
      expect(await count('ledger_entries')).toBe(0);
      expect(await count('ledger_transactions')).toBe(0);
      expect(await balance('fee_revenue')).toBe(0);
      expect((await getWallet(worker)).availableCents).toBe(0);
      await submitReview(cliente, h.contractId, { rating: 5 });
      expect((await submitReview(worker, h.contractId, { rating: 5 })).published).toBe(true);
    } finally {
      config.platformFeeBps = null;
    }
  });
});

describe('Cenários: Avaliação unilateral oculta / Avaliações bilaterais', () => {
  it('uma avaliação fica oculta e não altera a média, nem após sete dias; a segunda publica ambas atomicamente', async () => {
    const { cliente, worker } = await setup();
    const h = await fundedAndSubmitted(cliente, worker);
    expect(await failure(submitReview(cliente, h.contractId, { rating: 5 }))).toMatchObject({ status: 422 }); // ainda não concluído
    await approveUnit(cliente, h.unitId);
    expect(await submitReview(cliente, h.contractId, { rating: 2, comment: 'Atrasou bastante.', punctuality: 1 })).toEqual({ published: false });
    expect(await failure(submitReview(cliente, h.contractId, { rating: 5 }))).toMatchObject({ status: 409 });
    expect(await failure(submitReview(await mkUser('Outro'), h.contractId, { rating: 5 }))).toMatchObject({ status: 404 });
    expect(await failure(submitReview(worker, h.contractId, { rating: 6 }))).toMatchObject({ status: 400 });

    advance(8 * 24 * 60);
    const forWorker = await getReviewState(worker, h.contractId);
    expect(forWorker).toEqual({ mine: null, theirs: null, published: false });
    expect(JSON.stringify(forWorker)).not.toContain('Atrasou');
    expect(await reputation(worker.id, 'worker')).toEqual({ count: 0, average10: null });

    expect(await submitReview(worker, h.contractId, { rating: 4 })).toEqual({ published: true });
    const rows = await q<{ published_at: Date }>('SELECT published_at FROM reviews WHERE contract_id=$1', [h.contractId]);
    expect(rows).toHaveLength(2);
    expect(rows[0].published_at).not.toBeNull();
    expect(rows[0].published_at.getTime()).toBe(rows[1].published_at.getTime());
    expect((await getReviewState(worker, h.contractId)).theirs).toMatchObject({ rating: 2, comment: 'Atrasou bastante.' });
    // reputação separada por papel
    expect(await reputation(worker.id, 'worker')).toEqual({ count: 1, average10: 20 });
    expect(await reputation(worker.id, 'client')).toEqual({ count: 0, average10: null });
    expect(await reputation(cliente.id, 'client')).toEqual({ count: 1, average10: 40 });
  });
});

describe('Cenários de cancelamento e multa', () => {
  it('urgente sem deslocamento: contratante cancela sem multa e os fundos retidos voltam à carteira', async () => {
    const { cliente, worker } = await setup();
    const h = await hire(cliente, worker, await mkRequest(cliente));
    await pay(cliente, h.contractId);
    const p = await previewCancellation(cliente, h.contractId);
    expect(p).toMatchObject({ outcome: 'free', penaltyCents: 0, refundToClientCents: 12000 });
    expect(await status('contracts', h.contractId)).toBe('confirmed'); // prévia não muta
    await cancelContract(cliente, h.contractId, { reason: 'Não preciso mais', expectedPenaltyCents: 0 });
    expect(await balance('client_wallet', { userId: cliente.id })).toBe(12000);
    expect(await balance('unit_reserve', { unitId: h.unitId })).toBe(0);
    expect(await count('penalties')).toBe(0);
  });

  it('multa demonstrativa com teto: 10% de 200000 limitado a 10000, sem segunda multa pelo mesmo fato', async () => {
    const { cliente, worker } = await setup();
    const h = await hire(cliente, worker, await mkRequest(cliente, { priceCents: 200000 }));
    await pay(cliente, h.contractId);
    const antes = await previewCancellation(cliente, h.contractId);
    await markDeparture(worker, h.contractId);
    // condições mudaram desde a prévia: exige nova confirmação
    expect(await failure(cancelContract(cliente, h.contractId, { reason: 'Desisti', expectedPenaltyCents: antes.penaltyCents }))).toMatchObject({ status: 409, code: 'preview_changed' });
    const p = await previewCancellation(cliente, h.contractId);
    expect(p).toMatchObject({ outcome: 'penalty', penaltyCents: 10000, penaltyBeneficiary: 'worker', refundToClientCents: 190000 });
    await cancelContract(cliente, h.contractId, { reason: 'Desisti', expectedPenaltyCents: 10000 });
    expect(await balance('worker_earnings', { userId: worker.id })).toBe(10000);
    expect(await balance('client_wallet', { userId: cliente.id })).toBe(190000);
    expect(await failure(cancelContract(cliente, h.contractId, { reason: 'De novo', expectedPenaltyCents: 10000 }))).toMatchObject({ status: 409 });
    expect(await count('penalties')).toBe(1);
  });

  it('serviço iniciado não é cancelamento simples', async () => {
    const { cliente, worker } = await setup();
    const h = await hire(cliente, worker, await mkRequest(cliente));
    await pay(cliente, h.contractId);
    await startWork(worker, h.contractId);
    expect(await failure(cancelContract(cliente, h.contractId, { reason: 'Desisti', expectedPenaltyCents: 0 }))).toMatchObject({ status: 422, code: 'requires_support' });
    expect(await balance('unit_reserve', { unitId: h.unitId })).toBe(12000);
  });

  it('ausência exige contato no chat e espera de 15 minutos; multa vira dívida separada do trabalhador', async () => {
    const { cliente, worker } = await setup();
    const id = await mkRequest(cliente);
    const h = await hire(cliente, worker, id);
    await pay(cliente, h.contractId);
    expect(await failure(reportNoShow(cliente, h.contractId, ''))).toMatchObject({ status: 422, code: 'no_contact' });
    const conv = await openConversationAsWorker(worker, id);
    advance(30);
    await postMessage(cliente, conv, 'Você está a caminho?');
    advance(14);
    expect(await failure(reportNoShow(cliente, h.contractId, ''))).toMatchObject({ status: 422, code: 'wait_required' });
    advance(1);
    await reportNoShow(cliente, h.contractId, 'Profissional não apareceu');
    expect(await status('contracts', h.contractId)).toBe('cancelled');
    expect(await balance('client_wallet', { userId: cliente.id })).toBe(12000); // reembolso integral
    const w = await getWallet(worker);
    expect(w).toMatchObject({ availableCents: 0, debtCents: 2400 }); // 20% de 12000
    // dívida não cria saldo sacável nem é abatida silenciosamente
    expect(await failure(requestPayout(worker, { amountCents: 100, idempotencyKey: 'k1' }))).toMatchObject({ status: 422, code: 'insufficient_funds' });
  });
});

describe('Cenário: Contagem móvel de multas', () => {
  it('terceira multa válida em 12 meses encaminha análise, sem suspensão automática; anulada não conta', async () => {
    const worker = await mkWorker('Trabalhador'), suporte = await mkUser('Suporte', { support: true });

    async function workerPenalty() {
      const cliente = await mkUser('Cliente');
      const h = await hire(cliente, worker, await mkRequest(cliente));
      await pay(cliente, h.contractId);
      await markDeparture(worker, h.contractId);
      const p = await previewCancellation(worker, h.contractId);
      expect(p).toMatchObject({ outcome: 'penalty', responsible: 'worker', settlement: 'debt', penaltyCents: 1200 });
      await cancelContract(worker, h.contractId, { reason: 'Imprevisto', expectedPenaltyCents: p.penaltyCents });
      advance(24 * 60);
      await q('UPDATE worker_profiles SET online_until = $2 WHERE user_id = $1', [worker.id, new Date('2099-01-01')]);
      return (await q1<{ id: string }>('SELECT id FROM penalties ORDER BY created_at DESC LIMIT 1'))!.id;
    }

    const antiga = await workerPenalty();
    advance(13 * 31 * 24 * 60); // a primeira sai da janela de 12 meses
    await workerPenalty();
    const anulada = await workerPenalty();
    expect(await failure(voidPenalty(worker, anulada, 'Quero anular a minha multa.'))).toMatchObject({ status: 403 });
    expect(await failure(voidPenalty(suporte, anulada, 'curto'))).toMatchObject({ status: 400 });
    await voidPenalty(suporte, anulada, 'Trabalhador comprovou emergência médica.');
    expect((await getWallet(worker)).debtCents).toBe(2400); // estorno do débito anulado: restam duas multas
    await workerPenalty();
    // válidas na janela: 2 (uma antiga fora da janela, uma anulada)
    expect(await count('penalty_reviews')).toBe(0);
    await workerPenalty();
    expect(await count(`penalty_reviews WHERE user_id=$1 AND status='open'`, [worker.id])).toBe(1);
    expect((await q1<{ status: string }>('SELECT status FROM users WHERE id=$1', [worker.id]))!.status).toBe('active'); // sem banimento automático
    expect(antiga).toBeTruthy();
    expect(await count(`audit_events WHERE action='penalty.void'`)).toBe(1);

    // decisão humana, justificada e auditada
    const reviewId = (await q1<{ id: string }>('SELECT id FROM penalty_reviews'))!.id;
    await closePenaltyReview(suporte, reviewId, 'no_action', 'Multas em contextos distintos, sem padrão de abuso.');
    expect((await q1<{ status: string }>('SELECT status FROM users WHERE id=$1', [worker.id]))!.status).toBe('active');
  });
});

describe('Cenário: Saques concorrentes', () => {
  async function workerWith10000() {
    const { cliente, worker } = await setup();
    const h = await fundedAndSubmitted(cliente, worker, { priceCents: 10000 });
    await approveUnit(cliente, h.unitId);
    return { cliente, worker };
  }

  it('dois saques de 8000 com saldo de 10000: no máximo um é reservado; saldo não fica negativo', async () => {
    const { worker } = await workerWith10000();
    const results = await Promise.allSettled([
      requestPayout(worker, { amountCents: 8000, idempotencyKey: 'a' }),
      requestPayout(worker, { amountCents: 8000, idempotencyKey: 'b' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ status: 422, code: 'insufficient_funds' });
    expect(await getWallet(worker)).toMatchObject({ availableCents: 2000, inPayoutCents: 8000 });
  });

  it('mesma chave não duplica débito; falha devolve uma única vez; sucesso finaliza', async () => {
    const { worker } = await workerWith10000();
    const suporte = await mkUser('Suporte', { support: true });
    const a = await requestPayout(worker, { amountCents: 4000, idempotencyKey: 'k' });
    const b = await requestPayout(worker, { amountCents: 4000, idempotencyKey: 'k' });
    expect(b.id).toBe(a.id);
    expect(await failure(requestPayout(worker, { amountCents: 5000, idempotencyKey: 'k' }))).toMatchObject({ status: 409, code: 'idempotency_mismatch' });
    expect(await getWallet(worker)).toMatchObject({ availableCents: 6000, inPayoutCents: 4000 });
    expect(a.status).toBe('processing');

    // falha, com evento duplicado: devolve ao saldo uma vez
    await simulateProviderObject(suporte, a.provider_ref!, 'failure');
    const gw = getMockGateway();
    const dup = gw.sign({ id: 'evt_dup_falha', type: 'payout.failed', data: { providerRef: a.provider_ref!, amountCents: 4000, currency: 'BRL' } });
    await handleWebhook('mock', dup.rawBody, dup.signature);
    expect(await getWallet(worker)).toMatchObject({ availableCents: 10000, inPayoutCents: 0 });

    const c = await requestPayout(worker, { amountCents: 10000, idempotencyKey: 'k2' });
    await simulateProviderObject(suporte, c.provider_ref!, 'duplicate');
    expect(await getWallet(worker)).toMatchObject({ availableCents: 0, inPayoutCents: 0 });
    expect(await balance('provider_payout')).toBe(10000);
    expect(await status('payouts', c.id)).toBe('paid');
    expect((await reconciliation(suporte)).ok).toBe(true);
  });

  it('extrato e carteira são do próprio usuário', async () => {
    const { cliente, worker } = await workerWith10000();
    expect((await listWalletEntries(worker)).length).toBeGreaterThan(0);
    expect(await listWalletEntries(cliente)).toHaveLength(0);
    expect((await getWallet(cliente)).availableCents).toBe(0);
  });
});

describe('Cenário: Pagamento após expiração da reserva', () => {
  it('pagamento tardio não cria contrato excedente; valor vai para conciliação e volta em crédito', async () => {
    const cliente = await mkUser('Cliente'), w1 = await mkWorker('W1'), w2 = await mkWorker('W2');
    const id = await mkRequest(cliente, { seats: 1 });
    const h1 = await hire(cliente, w1, id);
    const atrasado = await createContractPayment(cliente, h1.contractId, { method: 'pix' });
    advance(16);
    await expireFundingHolds();
    const h2 = await hire(cliente, w2, id); // vaga ocupada por outra pessoa
    await pay(cliente, h2.contractId);

    await simulatePaymentOutcome(cliente, atrasado.id, 'duplicate');
    expect(await status('contracts', h1.contractId)).toBe('cancelled');
    expect(await count(`contracts WHERE request_id=$1 AND status <> 'cancelled'`, [id])).toBe(1);
    expect(await status('payments', atrasado.id)).toBe('late_reconciled');
    expect(await balance('reconciliation')).toBe(0);
    expect(await balance('client_wallet', { userId: cliente.id })).toBe(12000);
    expect(await balance('unit_reserve', { unitId: h1.unitId })).toBe(0);
    expect(await count(`refunds WHERE payment_id=$1`, [atrasado.id])).toBe(1);
    expect(await count(`audit_events WHERE action='payment.late_reconciled'`)).toBe(1);
  });

  it('crédito de carteira paga um novo serviço; sem saldo a aprovação é desfeita por inteiro', async () => {
    const cliente = await mkUser('Cliente'), w1 = await mkWorker('W1'), w2 = await mkWorker('W2');
    const id = await mkRequest(cliente, { seats: 2 });
    expect(await failure(hire(cliente, w1, id, 'wallet'))).toMatchObject({ status: 422, code: 'insufficient_funds' });
    expect(await count('contracts')).toBe(0);
    expect(await count(`proposals WHERE status='submitted'`)).toBe(1); // rollback completo

    const h = await hire(cliente, w2, id);
    await pay(cliente, h.contractId);
    await cancelContract(cliente, h.contractId, { reason: 'Teste', expectedPenaltyCents: 0 });
    expect(await balance('client_wallet', { userId: cliente.id })).toBe(12000);
    const p1 = (await q1<{ id: string }>(`SELECT id FROM proposals WHERE worker_id=$1 AND status='submitted'`, [w1.id]))!.id;
    const hw = await approveProposal(cliente, p1, { versionId: await currentVersionId(p1), paymentMode: 'wallet' });
    expect(hw.status).toBe('confirmed');
    expect(await balance('client_wallet', { userId: cliente.id })).toBe(0);
    expect(await balance('unit_reserve', { unitId: hw.unitId })).toBe(12000);
  });
});

describe('ledger imutável e balanceado', () => {
  it('lançamentos não podem ser alterados nem apagados; transação desbalanceada é recusada', async () => {
    const { cliente, worker } = await setup();
    const h = await fundedAndSubmitted(cliente, worker);
    await approveUnit(cliente, h.unitId);
    await expect(q('UPDATE ledger_entries SET amount_cents = amount_cents + 1')).rejects.toThrow(/append-only/);
    await expect(q('DELETE FROM ledger_entries')).rejects.toThrow(/append-only/);
    await expect(q('DELETE FROM ledger_transactions')).rejects.toThrow(/append-only/);
    await expect(post({
      kind: 'x', key: 'desbalanceada', refType: 't', refId: 't',
      legs: [{ account: await account('fee_revenue'), amount: 5 }, { account: await account('provider_clearing'), amount: -4 }],
    })).rejects.toThrow(/desbalanceada/);
    // direto no banco, contornando a aplicação: o trigger recusa ao confirmar
    const t = (await q1<{ id: string }>(`INSERT INTO ledger_transactions (kind, idempotency_key, reference_type, reference_id) VALUES ('x','direto','t','t') RETURNING id`))!.id;
    await expect(q('INSERT INTO ledger_entries (tx_id, account_id, amount_cents) VALUES ($1,$2,7)', [t, await account('fee_revenue')])).rejects.toThrow(/desbalanceada/);
    // saldo de conta de usuário não pode ficar negativo
    await expect(post({
      kind: 'x', key: 'negativo', refType: 't', refId: 't',
      legs: [{ account: await account('worker_earnings', { userId: cliente.id }), amount: -1 }, { account: await account('fee_revenue'), amount: 1 }],
    })).rejects.toMatchObject({ code: 'insufficient_funds' });
    expect((await ledgerHealth()).ok).toBe(true);
  });
});

it.todo('Cenário: Etapa contestada não contamina outras (etapas/marcos chegam com o B10)');

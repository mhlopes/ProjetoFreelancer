import { beforeEach, describe, expect, it } from 'vitest';
import { q, q1 } from '@/lib/db';
import { config } from '@/lib/config';
import { approveProposal, expireFundingHolds, getContractForSupport, getContractForViewer, markDeparture, startWork } from '@/modules/contracts';
import { cancelContract, previewCancellation } from '@/modules/cancellations';
import { getConversation, listMessages, openConversationAsWorker, postMessage } from '@/modules/chat';
import { register, setMode } from '@/modules/identity';
import { setOnline } from '@/modules/profiles';
import { agreeToCounter, counterOffer, listMyProposals, submitProposal } from '@/modules/proposals';
import { advanceMatching, createRequest, expireDueRequests, getRequestForViewer, listFeedForWorker, renewRequest } from '@/modules/requests';
import { blockUser } from '@/modules/trust';
import {
  advance, balance, categoryId, count, currentVersionId, failure, fakeCpf, freshDb, hire, mkRequest, mkUser, mkWorker, pay, SP, status,
} from './helpers';

beforeEach(freshDb);

describe('contas e elegibilidade', () => {
  it('recusa menores de 18 anos e CPF inválido', async () => {
    const base = { name: 'Pessoa Teste', email: 'menor@teste.invalid', phone: '11900000000', password: 'senha-de-teste' };
    expect(await failure(register({ ...base, cpf: fakeCpf(900), birthDate: '2010-01-01' }))).toMatchObject({ status: 400 });
    expect(await failure(register({ ...base, cpf: '123.456.789-00', birthDate: '1990-01-01' }))).toMatchObject({ status: 400 });
  });

  it('a mesma conta contrata e trabalha; ficar online exige telefone e identidade validados', async () => {
    const naoValidado = await mkWorker('Sem Validação', { verified: false, online: false });
    expect(await failure(setOnline(naoValidado, true))).toMatchObject({ status: 422, code: 'worker_not_verified' });
    const ana = await mkWorker('Ana', { online: false });
    await setMode(ana, 'worker');
    await setOnline(ana, true);
    // a mesma conta também publica pedidos
    await mkRequest(ana);
  });

  it('trabalhador não validado não recebe chamados; novato sem nota recebe', async () => {
    const cliente = await mkUser('Cliente');
    const novato = await mkWorker('Novato');
    const pendente = await mkWorker('Pendente', { verified: false });
    const offline = await mkWorker('Offline', { online: false });
    const longe = await mkWorker('Longe', { lat: SP.lat + 3, lng: SP.lng });
    const id = await mkRequest(cliente);
    const dispatched = (await q<{ worker_id: string }>('SELECT worker_id FROM request_dispatches WHERE request_id=$1', [id])).map((r) => r.worker_id);
    expect(dispatched).toEqual([novato.id]);
    expect(await failure(submitProposal(pendente, id, {}))).toMatchObject({ status: 422, code: 'worker_not_verified' });
    expect(await failure(getRequestForViewer(offline, id))).toMatchObject({ status: 404 });
    expect(await failure(getRequestForViewer(longe, id))).toMatchObject({ status: 404 });
  });

  it('distribuição em grupos: 10 por vez, sem alerta duplicado', async () => {
    const cliente = await mkUser('Cliente');
    for (let i = 0; i < 13; i++) await mkWorker(`T${i}`);
    const id = await mkRequest(cliente);
    expect(await count('request_dispatches WHERE request_id=$1', [id])).toBe(10);
    expect(await advanceMatching()).toBe(0); // intervalo ainda não venceu
    advance(2);
    expect(await advanceMatching()).toBe(3);
    advance(2);
    expect(await advanceMatching()).toBe(0);
    expect(await count(`notifications WHERE kind='request.dispatched'`)).toBe(13);
  });
});

describe('Cenário: Aprovação obrigatória do contratante', () => {
  it('aceitar o preço anunciado registra proposta, sem contrato', async () => {
    const cliente = await mkUser('Cliente'), worker = await mkWorker('Trabalhador');
    const id = await mkRequest(cliente);
    const proposalId = await submitProposal(worker, id, {}); // aceita o preço anunciado
    expect(await status('proposals', proposalId)).toBe('submitted');
    expect(await count('contracts')).toBe(0);
    expect(await count('schedule_reservations')).toBe(0);
  });

  it('trabalhador não consegue aprovar a si mesmo nem outro usuário aprovar pelo dono', async () => {
    const cliente = await mkUser('Cliente'), worker = await mkWorker('Trabalhador'), outro = await mkUser('Outro');
    const proposalId = await submitProposal(worker, await mkRequest(cliente), {});
    const versionId = await currentVersionId(proposalId);
    expect(await failure(approveProposal(worker, proposalId, { versionId, paymentMode: 'pix' }))).toMatchObject({ status: 404 });
    expect(await failure(approveProposal(outro, proposalId, { versionId, paymentMode: 'pix' }))).toMatchObject({ status: 404 });
    expect(await count('contracts')).toBe(0);
  });

  it('não é possível se candidatar ao próprio pedido', async () => {
    const ana = await mkWorker('Ana');
    const id = await mkRequest(ana);
    expect(await failure(submitProposal(ana, id, {}))).toMatchObject({ status: 404 }); // nem chega a ser distribuído a ela
    await q('INSERT INTO request_dispatches (request_id, worker_id, wave, cycle) VALUES ($1,$2,1,0)', [id, ana.id]);
    expect(await failure(submitProposal(ana, id, {}))).toMatchObject({ status: 422, code: 'self_hire' });
  });
});

describe('Cenário: Última vaga concorrente', () => {
  it('duas aprovações simultâneas: uma reserva, a outra recebe 409 sem cobrança', async () => {
    const cliente = await mkUser('Cliente'), w1 = await mkWorker('W1'), w2 = await mkWorker('W2');
    const id = await mkRequest(cliente, { seats: 1 });
    const p1 = await submitProposal(w1, id, {}), p2 = await submitProposal(w2, id, {});
    const [v1, v2] = [await currentVersionId(p1), await currentVersionId(p2)];
    const results = await Promise.allSettled([
      approveProposal(cliente, p1, { versionId: v1, paymentMode: 'pix' }),
      approveProposal(cliente, p2, { versionId: v2, paymentMode: 'pix' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ status: 409, code: 'no_seats' });
    expect(await count(`contracts WHERE status <> 'cancelled'`)).toBe(1);
    expect(await count('payments')).toBe(0);
    expect(await count('ledger_entries')).toBe(0);
  });

  it('pedido com N vagas gera no máximo N contratos independentes', async () => {
    const cliente = await mkUser('Cliente');
    const ws = [await mkWorker('W1'), await mkWorker('W2'), await mkWorker('W3')];
    const id = await mkRequest(cliente, { seats: 2 });
    await hire(cliente, ws[0], id);
    await hire(cliente, ws[1], id);
    expect(await failure(hire(cliente, ws[2], id))).toMatchObject({ status: 409, code: 'no_seats' });
    expect(await count('contracts WHERE request_id=$1', [id])).toBe(2);
  });
});

describe('Cenário: Negociação preserva versões', () => {
  it('contrato referencia a versão de 12000 e o histórico continua', async () => {
    const cliente = await mkUser('Cliente'), worker = await mkWorker('Trabalhador');
    const id = await mkRequest(cliente, { priceCents: 10000 });
    const proposalId = await submitProposal(worker, id, { amountCents: 10000 });
    await counterOffer(worker, proposalId, { amountCents: 12000, scope: 'Limpeza de cozinha com forno', expectedVersion: 1 });
    const versionId = await currentVersionId(proposalId);
    const { contractId } = await approveProposal(cliente, proposalId, { versionId, paymentMode: 'pix' });
    const c = await q1<{ amount_cents: number; budget_cents: number; accepted_version_id: string }>('SELECT * FROM contracts WHERE id=$1', [contractId]);
    expect(c).toMatchObject({ amount_cents: 12000, budget_cents: 12000, accepted_version_id: versionId });
    const versions = await q<{ amount_cents: number }>('SELECT amount_cents FROM proposal_versions WHERE proposal_id=$1 ORDER BY version_no', [proposalId]);
    expect(versions.map((v) => v.amount_cents)).toEqual([10000, 12000]);
  });

  it('versão antiga ou não aceita pelo trabalhador não contrata', async () => {
    const cliente = await mkUser('Cliente'), worker = await mkWorker('Trabalhador');
    const proposalId = await submitProposal(worker, await mkRequest(cliente), { amountCents: 15000 });
    const v1 = await currentVersionId(proposalId);
    await counterOffer(cliente, proposalId, { amountCents: 11000, scope: 'Somente a cozinha', expectedVersion: 1 });
    const v2 = await currentVersionId(proposalId);
    // contratante não consegue contratar pela própria contraproposta sem o aceite do trabalhador
    expect(await failure(approveProposal(cliente, proposalId, { versionId: v2, paymentMode: 'pix' }))).toMatchObject({ status: 409, code: 'stale_proposal' });
    // resposta a versão desatualizada é recusada
    expect(await failure(counterOffer(worker, proposalId, { amountCents: 14000, scope: 'Outra', expectedVersion: 1 }))).toMatchObject({ status: 409, code: 'stale_proposal' });
    await agreeToCounter(worker, proposalId, 2);
    expect(await count('contracts')).toBe(0); // concordar ainda não contrata
    expect(await failure(approveProposal(cliente, proposalId, { versionId: v1, paymentMode: 'pix' }))).toMatchObject({ status: 409, code: 'stale_proposal' });
    const { contractId } = await approveProposal(cliente, proposalId, { versionId: v2, paymentMode: 'pix' });
    expect((await q1<{ amount_cents: number }>('SELECT amount_cents FROM contracts WHERE id=$1', [contractId]))!.amount_cents).toBe(11000);
  });

  it('valor cobrado vem do acordo no servidor', async () => {
    const cliente = await mkUser('Cliente'), worker = await mkWorker('Trabalhador');
    const h = await hire(cliente, worker, await mkRequest(cliente), 'pix', 13500);
    const p = await pay(cliente, h.contractId);
    expect(p.amount_cents).toBe(13500);
    expect(await balance('unit_reserve', { unitId: h.unitId })).toBe(13500);
  });
});

describe('Cenário: Agenda impede sobreposição', () => {
  const sched = (startsAtLocal: string) => ({ kind: 'scheduled' as const, startsAtLocal, durationMinutes: 120 });

  it('11h–13h é recusado com contrato 10h–12h; começando às 12h pode', async () => {
    const c1 = await mkUser('C1'), c2 = await mkUser('C2'), c3 = await mkUser('C3'), worker = await mkWorker('Trabalhador');
    const h1 = await hire(c1, worker, await mkRequest(c1, sched('2026-11-20T10:00')));
    await pay(c1, h1.contractId);
    expect(await status('contracts', h1.contractId)).toBe('confirmed');

    const r2 = await mkRequest(c2, sched('2026-11-20T11:00'));
    // com contrato confirmado no horário, o trabalhador nem é distribuído; forçamos a candidatura para testar a trava
    await q('INSERT INTO request_dispatches (request_id, worker_id, wave, cycle) VALUES ($1,$2,1,0) ON CONFLICT DO NOTHING', [r2, worker.id]);
    expect(await failure(hire(c2, worker, r2))).toMatchObject({ status: 409, code: 'schedule_conflict' });
    expect(await count('contracts WHERE request_id=$1', [r2])).toBe(0);

    const r3 = await mkRequest(c3, sched('2026-11-20T12:00'));
    const h3 = await hire(c3, worker, r3);
    await pay(c3, h3.contractId);
    expect(await status('contracts', h3.contractId)).toBe('confirmed');
  });

  it('o banco recusa sobreposição mesmo se a aplicação falhar em checar', async () => {
    const c1 = await mkUser('C1'), worker = await mkWorker('Trabalhador');
    await hire(c1, worker, await mkRequest(c1, sched('2026-11-20T10:00'))); // 13h–15h UTC
    const h2 = await hire(c1, worker, await mkRequest(c1, sched('2026-11-20T15:00'))); // 18h–20h UTC
    expect(await failure(q(
      `UPDATE schedule_reservations SET during = tstzrange('2026-11-20T14:00:00Z','2026-11-20T16:00:00Z','[)') WHERE contract_id = $1`, [h2.contractId],
    ))).toMatchObject({ status: 409, code: 'schedule_conflict' });
  });

  it('reserva temporária expira e libera vaga e agenda', async () => {
    const cliente = await mkUser('Cliente'), w1 = await mkWorker('W1'), w2 = await mkWorker('W2');
    const id = await mkRequest(cliente, { seats: 1 });
    const h1 = await hire(cliente, w1, id);
    expect(await status('contracts', h1.contractId)).toBe('awaiting_funding');
    advance(14);
    expect(await expireFundingHolds()).toBe(0);
    advance(2);
    expect(await expireFundingHolds()).toBe(1);
    expect(await status('contracts', h1.contractId)).toBe('cancelled');
    const h2 = await hire(cliente, w2, id);
    expect(await status('contracts', h2.contractId)).toBe('awaiting_funding');
  });
});

describe('Cenário: Privacidade antes da contratação', () => {
  it('candidato vê só localização aproximada; endereço exato só após contrato confirmado', async () => {
    const cliente = await mkUser('Cliente'), worker = await mkWorker('Trabalhador'), estranho = await mkWorker('Estranho', { online: false });
    const id = await mkRequest(cliente, { street: 'Rua Secreta', number: '42' });
    const asCandidate = await getRequestForViewer(worker, id);
    expect(asCandidate.role).toBe('candidate');
    expect(asCandidate.location).toBeNull();
    const json = JSON.stringify(asCandidate);
    expect(json).not.toContain('Rua Secreta');
    expect(asCandidate.request.approx_lat).toBe(-23.55); // arredondado
    expect(json).not.toContain(String(SP.lat));
    expect(JSON.stringify(await listFeedForWorker(worker))).not.toContain('Rua Secreta');
    expect(await failure(getRequestForViewer(estranho, id))).toMatchObject({ status: 404 });

    const h = await hire(cliente, worker, id);
    // aprovado, mas ainda não confirmado financeiramente: continua sem endereço
    expect((await getRequestForViewer(worker, id)).location).toBeNull();
    expect((await getContractForViewer(worker, h.contractId)).location).toBeNull();
    await pay(cliente, h.contractId);
    expect((await getRequestForViewer(worker, id)).location).toMatchObject({ street: 'Rua Secreta', number: '42' });
    expect((await getContractForViewer(worker, h.contractId)).location).toMatchObject({ street: 'Rua Secreta' });
    expect(await failure(getContractForViewer(estranho, h.contractId))).toMatchObject({ status: 404 });
  });

  it('chat é restrito ao contratante e àquele candidato', async () => {
    const cliente = await mkUser('Cliente'), w1 = await mkWorker('W1'), w2 = await mkWorker('W2');
    const id = await mkRequest(cliente, { seats: 2 });
    const conv = await openConversationAsWorker(w1, id);
    await postMessage(w1, conv, 'Olá, posso levar meus produtos?');
    await postMessage(cliente, conv, 'Pode sim.');
    expect((await listMessages(cliente, conv)).map((m) => m.body)).toEqual(['Olá, posso levar meus produtos?', 'Pode sim.']);
    // outro candidato do mesmo pedido não lê nem escreve
    expect(await failure(listMessages(w2, conv))).toMatchObject({ status: 404 });
    expect(await failure(postMessage(w2, conv, 'oi'))).toMatchObject({ status: 404 });
    expect(await failure(getConversation(w2, conv))).toMatchObject({ status: 404 });
    // candidato só vê a própria negociação
    await submitProposal(w1, id, {});
    expect(await listMyProposals(w2, id)).toHaveLength(0);
  });
});

describe('pedido urgente: expiração e renovação', () => {
  it('expira em 3h, encerra novas propostas e preserva contratos confirmados', async () => {
    const cliente = await mkUser('Cliente'), w1 = await mkWorker('W1'), w2 = await mkWorker('W2');
    const id = await mkRequest(cliente, { seats: 2 });
    const h = await hire(cliente, w1, id);
    await pay(cliente, h.contractId);
    advance(179);
    expect(await expireDueRequests()).toBe(0);
    advance(1);
    expect(await expireDueRequests()).toBe(1);
    expect(await status('service_requests', id)).toBe('expired');
    expect(await failure(submitProposal(w2, id, {}))).toMatchObject({ status: 409, code: 'request_closed' });
    expect(await status('contracts', h.contractId)).toBe('confirmed');
    await renewRequest(cliente, id);
    expect(await status('service_requests', id)).toBe('open');
    expect(await count('contracts WHERE request_id=$1', [id])).toBe(1); // renovar não duplica contratos
    await submitProposal(w2, id, {});
  });
});

describe('Cenário: Cancelamento de uma vaga', () => {
  it('cancelar um contrato preserva os outros dois', async () => {
    const cliente = await mkUser('Cliente');
    const ws = [await mkWorker('W1'), await mkWorker('W2'), await mkWorker('W3')];
    const id = await mkRequest(cliente, { seats: 3 });
    const hs = [];
    for (const w of ws) {
      const h = await hire(cliente, w, id);
      await pay(cliente, h.contractId);
      hs.push(h);
    }
    const before = await q('SELECT id, status, budget_cents FROM contracts WHERE id IN ($1,$2)', [hs[1].contractId, hs[2].contractId]);
    const p = await previewCancellation(cliente, hs[0].contractId);
    await cancelContract(cliente, hs[0].contractId, { reason: 'Mudança de planos', expectedPenaltyCents: p.penaltyCents });
    expect(await status('contracts', hs[0].contractId)).toBe('cancelled');
    expect(await q('SELECT id, status, budget_cents FROM contracts WHERE id IN ($1,$2)', [hs[1].contractId, hs[2].contractId])).toEqual(before);
    expect(await balance('unit_reserve', { unitId: hs[1].unitId })).toBe(12000);
    expect(await balance('unit_reserve', { unitId: hs[2].unitId })).toBe(12000);
  });
});

describe('Cenário: Transporte não habilitado', () => {
  it('API recusa transporte e segurança com a flag operacional desligada', async () => {
    const cliente = await mkUser('Cliente');
    for (const slug of ['transporte', 'seguranca']) {
      const input = {
        categoryId: await categoryId(slug), kind: 'urgent' as const, title: 'Corrida particular', description: 'Levar do ponto A ao ponto B.',
        seats: 1, priceCents: 4000, billingUnit: 'fixed' as const, paymentKind: 'digital' as const, durationMinutes: 30,
        uf: 'SP', city: 'São Paulo', area: 'Centro', street: 'Rua Fictícia',
      };
      expect(await failure(createRequest(cliente, input))).toMatchObject({ status: 422, code: 'category_disabled' });
    }
    expect(await count('service_requests')).toBe(0);
  });

  it('mesmo pedido já existente não contrata se a categoria for desabilitada depois', async () => {
    const cliente = await mkUser('Cliente'), motorista = await mkWorker('Motorista', { slug: 'transporte' });
    config.features.transport = true;
    try {
      const id = await mkRequest(cliente, { categoryId: await categoryId('transporte') });
      const proposalId = await submitProposal(motorista, id, {});
      config.features.transport = false;
      expect(await failure(approveProposal(cliente, proposalId, { versionId: await currentVersionId(proposalId), paymentMode: 'pix' })))
        .toMatchObject({ status: 422, code: 'category_disabled' });
      expect(await count('contracts')).toBe(0);
    } finally {
      config.features.transport = false;
    }
  });
});

describe('Cenário: Bloqueio preserva histórico', () => {
  it('bloqueados não são pareados de novo; contrato existente e acesso auditado do suporte continuam', async () => {
    const cliente = await mkUser('Cliente'), worker = await mkWorker('Trabalhador'), suporte = await mkUser('Suporte', { support: true });
    const id1 = await mkRequest(cliente);
    const h = await hire(cliente, worker, id1);
    await pay(cliente, h.contractId);
    const conv = await openConversationAsWorker(worker, id1);
    await blockUser(cliente, worker.id, 'Não quero novos contatos');

    // contrato existente segue: execução e chat de atendimento preservados
    await markDeparture(worker, h.contractId);
    await startWork(worker, h.contractId);
    await postMessage(worker, conv, 'Cheguei ao local.');
    expect(await status('contracts', h.contractId)).toBe('in_progress');

    // novos pedidos: sem pareamento nem candidatura
    advance(200);
    const id2 = await mkRequest(cliente);
    expect(await count('request_dispatches WHERE request_id=$1 AND worker_id=$2', [id2, worker.id])).toBe(0);
    expect(await failure(submitProposal(worker, id2, {}))).toMatchObject({ status: 404 });
    await q('INSERT INTO request_dispatches (request_id, worker_id, wave, cycle) VALUES ($1,$2,1,0)', [id2, worker.id]);
    expect(await failure(submitProposal(worker, id2, {}))).toMatchObject({ status: 403 });
    expect(await listFeedForWorker(worker)).toHaveLength(0);

    // suporte mantém acesso autorizado e auditado aos registros
    expect(await failure(getContractForSupport(cliente, h.contractId, 'curiosidade'))).toMatchObject({ status: 403 });
    const rec = await getContractForSupport(suporte, h.contractId, 'Análise de denúncia');
    expect(rec.messages.map((m) => m.body)).toContain('Cheguei ao local.');
    expect(await count(`audit_events WHERE action='support.view_contract' AND actor_id=$1`, [suporte.id])).toBe(1);
  });
});

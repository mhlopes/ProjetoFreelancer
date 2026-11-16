'use server';

import { redirect } from 'next/navigation';
import { AppError } from '@/lib/errors';
import { parseBRL } from '@/lib/money';
import { clearSessionCookie, currentUser, sessionToken, setSessionCookie } from '@/lib/session';
import type { Actor } from '@/modules/core';
import { closeReport } from '@/modules/admin';
import { cancelContract, closePenaltyReview, reportNoShow, voidPenalty } from '@/modules/cancellations';
import { openConversationAsWorker, postMessage } from '@/modules/chat';
import { approveProposal, markDeparture, startWork } from '@/modules/contracts';
import type { MockScenario } from '@/modules/gateway';
import {
  createOrganization, login, logout, register, requestPhoneOtp, reviewOrganization, setMode, startIdentityVerification, toActor, verifyPhoneOtp,
} from '@/modules/identity';
import { runDueJobs } from '@/modules/jobs';
import { createContractPayment, simulatePaymentOutcome, simulateProviderObject } from '@/modules/payments';
import { addAvailabilityBlock, removeAvailabilityBlock, saveWorkerProfile, setOnline } from '@/modules/profiles';
import { agreeToCounter, counterOffer, rejectProposal, submitProposal, withdrawProposal } from '@/modules/proposals';
import { adjustRequestPrice, cancelRequest, closeRequest, createRequest, publishRequest, renewRequest } from '@/modules/requests';
import { submitReview } from '@/modules/reviews';
import {
  addWorkLog, approveUnit, confirmCash, openDispute, proposeCorrection, resolveDispute, respondCorrection, submitCompletion,
} from '@/modules/settlement';
import { blockUser, reportUser, unblockUser } from '@/modules/trust';
import { requestPayout } from '@/modules/wallet';
import { q } from '@/lib/db';

type Result = { to?: string; ok?: string } | void;

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const int = (fd: FormData, k: string) => (/^-?\d+$/.test(str(fd, k)) ? Number(str(fd, k)) : NaN);
const num = (fd: FormData, k: string) => (str(fd, k) === '' || Number.isNaN(Number(str(fd, k))) ? null : Number(str(fd, k)));

function money(fd: FormData, k: string): number {
  const v = parseBRL(str(fd, k));
  if (v == null) throw new AppError(400, 'invalid', 'Informe um valor em reais válido (ex.: 120,00).');
  return v;
}

/** Só aceita caminhos internos para o retorno (evita redirecionamento aberto). */
function safePath(p: string, fallback = '/'): string {
  return p.startsWith('/') && !p.startsWith('//') && !p.includes('\\') ? p : fallback;
}

function withFlash(path: string, key: 'ok' | 'erro', message: string) {
  const [base, hash] = path.split('#');
  const u = new URL(base, 'http://x');
  u.searchParams.delete('ok');
  u.searchParams.delete('erro');
  u.searchParams.set(key, message);
  return `${u.pathname}${u.search}${hash ? `#${hash}` : ''}`;
}

/**
 * Executa uma ação autenticada e redireciona com mensagem. Toda regra e permissão é verificada nos serviços;
 * aqui só há leitura do formulário e apresentação do resultado.
 */
async function run(fd: FormData, fn: (actor: Actor) => Promise<Result>, okMessage = 'Feito.') {
  const back = safePath(str(fd, '_back'));
  let target: string;
  const user = await currentUser();
  if (!user) redirect('/entrar');
  try {
    const r = await fn(toActor(user));
    target = withFlash(safePath(r?.to ?? back), 'ok', r?.ok ?? okMessage);
  } catch (e) {
    if (e instanceof AppError) target = withFlash(back, 'erro', e.message);
    else {
      console.error('[action] erro inesperado', e);
      target = withFlash(back, 'erro', 'Erro inesperado. Tente novamente.');
    }
  }
  redirect(target);
}

// ───────────── Conta ─────────────

export async function registerAction(fd: FormData) {
  let target = '/perfil?ok=' + encodeURIComponent('Conta criada. Valide telefone e identidade para trabalhar.');
  try {
    await register({
      name: str(fd, 'name'), email: str(fd, 'email'), phone: str(fd, 'phone'), cpf: str(fd, 'cpf'),
      birthDate: str(fd, 'birthDate'), password: String(fd.get('password') ?? ''),
    });
    const { token } = await login(str(fd, 'email'), String(fd.get('password') ?? ''));
    await setSessionCookie(token);
  } catch (e) {
    if (!(e instanceof AppError)) console.error('[action] cadastro', e);
    target = withFlash('/cadastro', 'erro', e instanceof AppError ? e.message : 'Erro inesperado. Tente novamente.');
  }
  redirect(target);
}

export async function loginAction(fd: FormData) {
  let target = '/';
  try {
    const { token } = await login(str(fd, 'email'), String(fd.get('password') ?? ''));
    await setSessionCookie(token);
  } catch (e) {
    if (!(e instanceof AppError)) console.error('[action] login', e);
    target = withFlash('/entrar', 'erro', e instanceof AppError ? e.message : 'Erro inesperado. Tente novamente.');
  }
  redirect(target);
}

export async function logoutAction() {
  await logout(await sessionToken());
  await clearSessionCookie();
  redirect('/entrar');
}

export async function setModeAction(fd: FormData) {
  const mode = str(fd, 'mode');
  await run(fd, async (a) => {
    await setMode(a, mode);
    return { to: mode === 'worker' ? '/trabalhar' : '/contratar', ok: mode === 'worker' ? 'Área de trabalho.' : 'Área de contratação.' };
  });
}

export async function requestOtpAction(fd: FormData) {
  await run(fd, async (a) => {
    const { mockCode } = await requestPhoneOtp(a);
    return { ok: `SIMULADO — nenhum SMS foi enviado. Código de teste: ${mockCode}` };
  });
}

export async function verifyOtpAction(fd: FormData) {
  await run(fd, (a) => verifyPhoneOtp(a, str(fd, 'code')), 'Telefone validado.');
}

export async function verifyIdentityAction(fd: FormData) {
  await run(fd, async (a) => {
    const s = await startIdentityVerification(a, str(fd, 'scenario') === 'fail' ? 'fail' : 'approve');
    return { ok: s === 'verified' ? 'SIMULADO — identidade aprovada pelo verificador de teste.' : 'SIMULADO — verificação reprovada. Tente novamente.' };
  });
}

export async function createOrgAction(fd: FormData) {
  await run(fd, async (a) => { await createOrganization(a, { name: str(fd, 'name'), cnpj: str(fd, 'cnpj') }); }, 'Empresa cadastrada. Aguarde a aprovação do suporte.');
}

// ───────────── Perfil profissional ─────────────

export async function saveWorkerProfileAction(fd: FormData) {
  await run(fd, (a) => saveWorkerProfile(a, {
    bio: str(fd, 'bio'), experience: str(fd, 'experience'), radiusKm: int(fd, 'radiusKm'), city: str(fd, 'city'), uf: str(fd, 'uf'),
    lat: num(fd, 'lat'), lng: num(fd, 'lng'), categoryIds: fd.getAll('categoryIds').map(String), tagIds: fd.getAll('tagIds').map(String),
  }), 'Perfil profissional salvo.');
}

export async function setOnlineAction(fd: FormData) {
  const on = str(fd, 'online') === '1';
  await run(fd, (a) => setOnline(a, on), on ? 'Você está aberto a trabalho agora.' : 'Você ficou indisponível.');
}

export async function addAvailabilityBlockAction(fd: FormData) {
  await run(fd, (a) => addAvailabilityBlock(a, { startLocal: str(fd, 'startLocal'), endLocal: str(fd, 'endLocal'), note: str(fd, 'note') }), 'Período indisponível registrado.');
}

export async function removeAvailabilityBlockAction(fd: FormData) {
  await run(fd, (a) => removeAvailabilityBlock(a, str(fd, 'id')), 'Período removido.');
}

// ───────────── Pedidos ─────────────

export async function createRequestAction(fd: FormData) {
  await run(fd, async (a) => {
    const hours = int(fd, 'durationHours'), mins = int(fd, 'durationMinutes');
    const id = await createRequest(a, {
      categoryId: str(fd, 'categoryId'), tagIds: fd.getAll('tagIds').map(String), organizationId: str(fd, 'organizationId') || null,
      kind: str(fd, 'kind') as 'urgent' | 'scheduled', title: str(fd, 'title'), description: str(fd, 'description'), materials: str(fd, 'materials'),
      seats: int(fd, 'seats'), priceCents: money(fd, 'price'), billingUnit: str(fd, 'billingUnit') as 'fixed' | 'hour',
      paymentKind: str(fd, 'paymentKind') as 'digital' | 'cash', startsAtLocal: str(fd, 'startsAtLocal'),
      durationMinutes: (Number.isNaN(hours) ? 0 : hours) * 60 + (Number.isNaN(mins) ? 0 : mins),
      uf: str(fd, 'uf'), city: str(fd, 'city'), area: str(fd, 'area'), street: str(fd, 'street'), number: str(fd, 'number'),
      complement: str(fd, 'complement'), reference: str(fd, 'reference'), lat: num(fd, 'lat'), lng: num(fd, 'lng'),
    });
    return { to: `/contratar/pedidos/${id}`, ok: 'Rascunho criado. Revise e publique.' };
  });
}

export async function publishRequestAction(fd: FormData) {
  await run(fd, (a) => publishRequest(a, str(fd, 'id')), 'Pedido publicado. Os profissionais compatíveis estão sendo avisados em grupos.');
}
export async function renewRequestAction(fd: FormData) {
  await run(fd, (a) => renewRequest(a, str(fd, 'id')), 'Pedido renovado.');
}
export async function adjustPriceAction(fd: FormData) {
  await run(fd, (a) => adjustRequestPrice(a, str(fd, 'id'), money(fd, 'price')), 'Valor atualizado.');
}
export async function closeRequestAction(fd: FormData) {
  await run(fd, (a) => closeRequest(a, str(fd, 'id')), 'Vagas encerradas. Os contratos existentes continuam valendo.');
}
export async function cancelRequestAction(fd: FormData) {
  await run(fd, (a) => cancelRequest(a, str(fd, 'id')), 'Pedido cancelado sem custo.');
}

// ───────────── Propostas ─────────────

export async function submitProposalAction(fd: FormData) {
  await run(fd, async (a) => {
    const accept = str(fd, 'acceptAdvertised') === '1';
    await submitProposal(a, str(fd, 'requestId'), accept ? {} : { amountCents: money(fd, 'amount'), scope: str(fd, 'scope') });
  }, 'Proposta enviada. A contratação depende da aprovação do contratante.');
}

export async function counterOfferAction(fd: FormData) {
  await run(fd, (a) => counterOffer(a, str(fd, 'proposalId'), { amountCents: money(fd, 'amount'), scope: str(fd, 'scope'), expectedVersion: int(fd, 'expectedVersion') }), 'Contraproposta enviada.');
}
export async function agreeAction(fd: FormData) {
  await run(fd, (a) => agreeToCounter(a, str(fd, 'proposalId'), int(fd, 'expectedVersion')), 'Você concordou. Agora falta a aprovação do contratante.');
}
export async function rejectProposalAction(fd: FormData) {
  await run(fd, (a) => rejectProposal(a, str(fd, 'proposalId')), 'Proposta recusada.');
}
export async function withdrawProposalAction(fd: FormData) {
  await run(fd, (a) => withdrawProposal(a, str(fd, 'proposalId')), 'Proposta retirada.');
}

export async function approveProposalAction(fd: FormData) {
  await run(fd, async (a) => {
    const mode = str(fd, 'paymentMode');
    const r = await approveProposal(a, str(fd, 'proposalId'), {
      versionId: str(fd, 'versionId'), paymentMode: mode,
      expectedRequestVersion: Number.isNaN(int(fd, 'expectedRequestVersion')) ? undefined : int(fd, 'expectedRequestVersion'),
    });
    if (r.status === 'awaiting_funding') {
      const p = await createContractPayment(a, r.contractId, { method: mode });
      return { to: `/pagamentos/${p.id}`, ok: 'Profissional aprovado. Conclua o pagamento para confirmar a contratação.' };
    }
    return { to: `/contratos/${r.contractId}`, ok: 'Contratação confirmada.' };
  });
}

// ───────────── Chat ─────────────

export async function openConversationAction(fd: FormData) {
  await run(fd, async (a) => ({ to: `/mensagens/${await openConversationAsWorker(a, str(fd, 'requestId'))}`, ok: 'Conversa aberta.' }));
}
export async function postMessageAction(fd: FormData) {
  await run(fd, async (a) => { await postMessage(a, str(fd, 'conversationId'), String(fd.get('body') ?? '')); }, 'Mensagem enviada.');
}

// ───────────── Contrato ─────────────

export async function startPaymentAction(fd: FormData) {
  await run(fd, async (a) => {
    const p = await createContractPayment(a, str(fd, 'contractId'), { method: str(fd, 'method') });
    return { to: `/pagamentos/${p.id}`, ok: 'Cobrança criada.' };
  });
}

export async function simulatePaymentAction(fd: FormData) {
  await run(fd, async (a) => {
    const scenario = str(fd, 'scenario') as MockScenario;
    await simulatePaymentOutcome(a, str(fd, 'paymentId'), scenario);
    return { ok: scenario === 'failure' ? 'SIMULADO — o provedor de teste recusou o pagamento.' : scenario === 'delay' ? 'SIMULADO — confirmação atrasada: chegará em cerca de 2 minutos.' : 'SIMULADO — evento de confirmação entregue pelo provedor de teste.' };
  });
}

export async function departureAction(fd: FormData) {
  await run(fd, (a) => markDeparture(a, str(fd, 'contractId')), 'Deslocamento registrado.');
}
export async function startWorkAction(fd: FormData) {
  await run(fd, (a) => startWork(a, str(fd, 'contractId')), 'Serviço iniciado.');
}
export async function addWorkLogAction(fd: FormData) {
  await run(fd, (a) => addWorkLog(a, str(fd, 'unitId'), { date: str(fd, 'date'), minutes: int(fd, 'hours') * 60 + (Number.isNaN(int(fd, 'minutes')) ? 0 : int(fd, 'minutes')), note: str(fd, 'note') }), 'Horas registradas.');
}
export async function submitCompletionAction(fd: FormData) {
  await run(fd, (a) => submitCompletion(a, str(fd, 'unitId'), { summary: str(fd, 'summary') }), 'Conclusão registrada.');
}
export async function approveUnitAction(fd: FormData) {
  await run(fd, async (a) => { await approveUnit(a, str(fd, 'unitId')); }, 'Conclusão confirmada. Pagamento liberado ao profissional.');
}
export async function disputeAction(fd: FormData) {
  await run(fd, async (a) => { await openDispute(a, str(fd, 'unitId'), str(fd, 'reason')); }, 'Contestação aberta. O valor fica bloqueado até a análise do suporte.');
}
export async function correctionAction(fd: FormData) {
  await run(fd, (a) => proposeCorrection(a, str(fd, 'unitId'), int(fd, 'hours') * 60 + (Number.isNaN(int(fd, 'minutes')) ? 0 : int(fd, 'minutes'))), 'Correção enviada ao profissional.');
}
export async function respondCorrectionAction(fd: FormData) {
  const accept = str(fd, 'accept') === '1';
  await run(fd, (a) => respondCorrection(a, str(fd, 'unitId'), accept), accept ? 'Correção aceita. Pagamento liberado.' : 'Correção recusada. O suporte vai analisar.');
}
export async function cashConfirmAction(fd: FormData) {
  await run(fd, (a) => confirmCash(a, str(fd, 'contractId')), 'Confirmação registrada.');
}
export async function cancelContractAction(fd: FormData) {
  await run(fd, async (a) => {
    await cancelContract(a, str(fd, 'contractId'), { reason: str(fd, 'reason'), expectedPenaltyCents: int(fd, 'expectedPenaltyCents'), policyVersion: int(fd, 'policyVersion') });
  }, 'Contrato cancelado.');
}
export async function noShowAction(fd: FormData) {
  await run(fd, async (a) => { await reportNoShow(a, str(fd, 'contractId'), str(fd, 'reason')); }, 'Ausência registrada.');
}
export async function reviewAction(fd: FormData) {
  await run(fd, async (a) => {
    const r = await submitReview(a, str(fd, 'contractId'), {
      rating: str(fd, 'rating'), punctuality: str(fd, 'punctuality'), quality: str(fd, 'quality'), communication: str(fd, 'communication'), comment: str(fd, 'comment'),
    });
    return { ok: r.published ? 'Avaliações publicadas.' : 'Avaliação registrada. Ela será publicada quando ambos avaliarem.' };
  });
}

// ───────────── Carteira, proteção, notificações ─────────────

export async function payoutAction(fd: FormData) {
  await run(fd, async (a) => { await requestPayout(a, { amountCents: money(fd, 'amount'), idempotencyKey: str(fd, 'idem') }); }, 'Saque solicitado.');
}
export async function blockAction(fd: FormData) {
  await run(fd, (a) => blockUser(a, str(fd, 'targetId'), str(fd, 'reason')), 'Usuário bloqueado. Contratos existentes não são afetados.');
}
export async function unblockAction(fd: FormData) {
  await run(fd, (a) => unblockUser(a, str(fd, 'targetId')), 'Bloqueio removido.');
}
export async function reportAction(fd: FormData) {
  await run(fd, (a) => reportUser(a, { targetUserId: str(fd, 'targetId'), contractId: str(fd, 'contractId') || null, reason: str(fd, 'reason'), details: str(fd, 'details') }), 'Denúncia enviada ao suporte.');
}
export async function markNotificationsReadAction(fd: FormData) {
  await run(fd, async (a) => { await q('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [a.id]); }, 'Notificações marcadas como lidas.');
}

// ───────────── Suporte ─────────────

export async function reviewOrgAction(fd: FormData) {
  await run(fd, (a) => reviewOrganization(a, str(fd, 'id'), str(fd, 'decision') === 'approved' ? 'approved' : 'rejected', str(fd, 'reason')), 'Decisão registrada.');
}
export async function resolveDisputeAction(fd: FormData) {
  await run(fd, async (a) => {
    const resolution = str(fd, 'resolution') as 'release' | 'refund' | 'partial';
    await resolveDispute(a, str(fd, 'id'), { resolution, workerCents: resolution === 'partial' ? money(fd, 'workerAmount') : undefined, note: str(fd, 'note') });
    return { to: '/admin#disputas', ok: 'Disputa resolvida.' };
  });
}
export async function voidPenaltyAction(fd: FormData) {
  await run(fd, (a) => voidPenalty(a, str(fd, 'id'), str(fd, 'reason')), 'Multa anulada.');
}
export async function closePenaltyReviewAction(fd: FormData) {
  await run(fd, (a) => closePenaltyReview(a, str(fd, 'id'), str(fd, 'decision') === 'blocked' ? 'blocked' : 'no_action', str(fd, 'note')), 'Análise encerrada.');
}
export async function closeReportAction(fd: FormData) {
  await run(fd, (a) => closeReport(a, str(fd, 'id'), str(fd, 'note')), 'Denúncia encerrada.');
}
export async function simulateProviderAction(fd: FormData) {
  await run(fd, (a) => simulateProviderObject(a, str(fd, 'ref'), str(fd, 'scenario') as MockScenario), 'SIMULADO — evento do provedor de teste entregue.');
}
export async function runJobsAction(fd: FormData) {
  await run(fd, async (a) => {
    if (!a.isSupport) throw new AppError(403, 'forbidden', 'Sem permissão.');
    const r = await runDueJobs();
    return { ok: `Jobs executados: ${Object.entries(r).filter(([, n]) => n !== 0).map(([k, n]) => `${k}=${n}`).join(', ') || 'nada pendente'}.` };
  });
}

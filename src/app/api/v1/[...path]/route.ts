import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { sha256 } from '@/lib/crypto';
import { q, q1, tx } from '@/lib/db';
import { AppError, conflict, forbidden, invalid, notFound, unauthenticated } from '@/lib/errors';
import { SESSION_COOKIE } from '@/lib/session';
import type { Actor } from '@/modules/core';
import { cancelContract, previewCancellation, voidPenalty } from '@/modules/cancellations';
import { listMessages, postMessage } from '@/modules/chat';
import { approveProposal, getContractForViewer, markDeparture, startWork } from '@/modules/contracts';
import { config } from '@/lib/config';
import { createOrganization, getUser, login, reviewOrganization, setMode, startIdentityVerification, toActor, userFromSessionToken } from '@/modules/identity';
import { createContractPayment, handleWebhook } from '@/modules/payments';
import { listCategories, setOnline } from '@/modules/profiles';
import { agreeToCounter, counterOffer, submitProposal } from '@/modules/proposals';
import { createRequest, getRequestForViewer, publishRequest, renewRequest } from '@/modules/requests';
import { getReviewState, submitReview } from '@/modules/reviews';
import { addWorkLog, approveUnit, confirmCash, openDispute, resolveDispute, submitCompletion } from '@/modules/settlement';
import { blockUser, reportUser } from '@/modules/trust';
import { getWallet, listWalletEntries, requestPayout } from '@/modules/wallet';

/**
 * API REST /api/v1 (docs/07-api.md). Camada fina: autenticação por sessão, proteção CSRF por origem,
 * Idempotency-Key nas operações financeiras e envelope de erro padronizado. Regras e permissões ficam nos serviços.
 */
type Ctx = { actor: Actor; body: any; p: string[]; url: URL; idem: string | null };
type Handler = (c: Ctx) => Promise<unknown>;
type Route = { method: string; re: RegExp; fn: Handler; idem?: boolean; public?: boolean };

const r = (method: string, pattern: string, fn: Handler, opts: { idem?: boolean; public?: boolean } = {}): Route => ({
  method, re: new RegExp(`^${pattern.replace(/:id/g, '([^/]+)')}$`), fn, ...opts,
});

const ROUTES: Route[] = [
  r('GET', 'categories', () => listCategories({ onlyEnabled: true }), { public: true }),
  r('GET', 'me', async ({ actor }) => getUser(actor.id)),
  r('PATCH', 'me', async ({ actor, body }) => { await setMode(actor, body.mode); return getUser(actor.id); }),
  r('POST', 'me/verification', async ({ actor, body }) => ({ status: await startIdentityVerification(actor, body.scenario === 'fail' ? 'fail' : 'approve'), simulated: true })),
  r('PUT', 'me/availability', async ({ actor, body }) => { await setOnline(actor, !!body.online); return { online: !!body.online }; }),
  r('POST', 'organizations', ({ actor, body }) => createOrganization(actor, { name: String(body.name ?? ''), cnpj: String(body.cnpj ?? '') })),
  r('POST', 'requests', async ({ actor, body }) => ({ id: await createRequest(actor, body) })),
  r('POST', 'requests/:id/publish', async ({ actor, p }) => { await publishRequest(actor, p[0]); return getRequestForViewer(actor, p[0]); }),
  r('POST', 'requests/:id/renew', async ({ actor, p }) => { await renewRequest(actor, p[0]); return getRequestForViewer(actor, p[0]); }),
  r('GET', 'requests/:id', ({ actor, p }) => getRequestForViewer(actor, p[0])),
  r('POST', 'requests/:id/proposals', async ({ actor, p, body }) => ({ id: await submitProposal(actor, p[0], { amountCents: body.amountCents, scope: body.scope }) })),
  r('POST', 'proposals/:id/counteroffers', async ({ actor, p, body }) => { await counterOffer(actor, p[0], { amountCents: body.amountCents, scope: String(body.scope ?? ''), expectedVersion: body.expectedVersion }); return { ok: true }; }),
  r('POST', 'proposals/:id/agree', async ({ actor, p, body }) => { await agreeToCounter(actor, p[0], body.expectedVersion); return { ok: true }; }),
  r('POST', 'proposals/:id/accept', ({ actor, p, body }) => approveProposal(actor, p[0], { versionId: body.proposalVersionId, paymentMode: body.paymentMode, expectedRequestVersion: body.expectedRequestVersion }), { idem: true }),
  // o corpo não carrega valor: o total é derivado do acordo no servidor
  r('POST', 'contracts/:id/payments', ({ actor, p, body }) => createContractPayment(actor, p[0], { method: String(body.method ?? 'pix') }), { idem: true }),
  r('GET', 'contracts/:id', ({ actor, p }) => getContractForViewer(actor, p[0])),
  r('POST', 'contracts/:id/departure', async ({ actor, p }) => { await markDeparture(actor, p[0]); return { ok: true }; }),
  r('POST', 'contracts/:id/start', async ({ actor, p }) => { await startWork(actor, p[0]); return { ok: true }; }),
  r('POST', 'units/:id/work-logs', async ({ actor, p, body }) => { await addWorkLog(actor, p[0], { date: String(body.date ?? ''), minutes: body.minutes, note: body.note }); return { ok: true }; }),
  r('POST', 'units/:id/submit', async ({ actor, p, body }) => { await submitCompletion(actor, p[0], { summary: String(body.summary ?? '') }); return { ok: true }; }),
  r('POST', 'units/:id/approve', ({ actor, p }) => approveUnit(actor, p[0]), { idem: true }),
  r('POST', 'units/:id/disputes', async ({ actor, p, body }) => ({ id: await openDispute(actor, p[0], String(body.reason ?? '')) })),
  r('POST', 'contracts/:id/cancellation-preview', ({ actor, p }) => previewCancellation(actor, p[0])),
  r('POST', 'contracts/:id/cancel', ({ actor, p, body }) => cancelContract(actor, p[0], { reason: String(body.reason ?? ''), expectedPenaltyCents: body.expectedPenaltyCents, policyVersion: body.policyVersion }), { idem: true }),
  r('POST', 'contracts/:id/cash-confirmation', async ({ actor, p }) => { await confirmCash(actor, p[0]); return { ok: true }; }),
  r('GET', 'conversations/:id/messages', ({ actor, p, url }) => listMessages(actor, p[0], Number(url.searchParams.get('after') ?? 0))),
  r('POST', 'conversations/:id/messages', ({ actor, p, body }) => postMessage(actor, p[0], String(body.body ?? ''))),
  r('POST', 'contracts/:id/reviews', ({ actor, p, body }) => submitReview(actor, p[0], body)),
  r('GET', 'contracts/:id/reviews', ({ actor, p }) => getReviewState(actor, p[0])),
  r('GET', 'wallet', ({ actor }) => getWallet(actor)),
  r('GET', 'wallet/entries', ({ actor }) => listWalletEntries(actor)),
  r('POST', 'wallet/payouts', ({ actor, body, idem }) => requestPayout(actor, { amountCents: body.amountCents, idempotencyKey: idem! }), { idem: true }),
  r('POST', 'blocks', async ({ actor, body }) => { await blockUser(actor, String(body.targetUserId ?? ''), String(body.reason ?? '')); return { ok: true }; }),
  r('POST', 'reports', async ({ actor, body }) => { await reportUser(actor, { targetUserId: String(body.targetUserId ?? ''), contractId: body.contractId, reason: String(body.reason ?? ''), details: body.details }); return { ok: true }; }),
  r('POST', 'admin/disputes/:id/resolve', async ({ actor, p, body }) => { await resolveDispute(actor, p[0], { resolution: body.resolution, workerCents: body.workerCents, note: String(body.note ?? '') }); return { ok: true }; }, { idem: true }),
  r('POST', 'admin/penalties/:id/void', async ({ actor, p, body }) => { await voidPenalty(actor, p[0], String(body.reason ?? '')); return { ok: true }; }, { idem: true }),
  r('POST', 'admin/organizations/:id/review', async ({ actor, p, body }) => { await reviewOrganization(actor, p[0], body.decision === 'approved' ? 'approved' : 'rejected', String(body.reason ?? '')); return { ok: true }; }),
];

function errorResponse(e: unknown, correlationId: string) {
  if (e instanceof AppError)
    return NextResponse.json({ code: e.code, message: e.message, fieldErrors: e.fieldErrors, correlationId }, { status: e.status });
  console.error(`[api] ${correlationId}`, e);
  return NextResponse.json({ code: 'internal', message: 'Erro interno.', correlationId }, { status: 500 });
}

/**
 * Mesma chave + mesmo corpo devolve o mesmo resultado; mesma chave com corpo diferente é 409.
 * A chave e o efeito são gravados na mesma transação.
 */
async function withIdempotency(scope: string, actor: Actor, key: string, hash: string, fn: () => Promise<unknown>) {
  return tx(async () => {
    const prev = await q1<{ request_hash: string; response: unknown }>(
      'SELECT request_hash, response FROM idempotency_keys WHERE scope=$1 AND key=$2 AND user_id=$3 FOR UPDATE', [scope, key, actor.id],
    );
    if (prev) {
      if (prev.request_hash !== hash) throw conflict('idempotency_mismatch', 'Esta Idempotency-Key já foi usada com outro conteúdo.');
      return prev.response;
    }
    const result = (await fn()) ?? null;
    await q('INSERT INTO idempotency_keys (scope, key, user_id, request_hash, response) VALUES ($1,$2,$3,$4,$5)', [
      scope, key, actor.id, hash, JSON.stringify(result),
    ]);
    return JSON.parse(JSON.stringify(result));
  });
}

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const correlationId = randomUUID();
  try {
    const path = (await ctx.params).path.join('/');
    const url = new URL(req.url);

    // Webhook do provedor: sem sessão; autenticado pela assinatura sobre o corpo bruto.
    const hook = /^webhooks\/payments\/([^/]+)$/.exec(path);
    if (hook && req.method === 'POST') {
      const raw = await req.text();
      const result = await handleWebhook(hook[1], raw, req.headers.get('x-signature'));
      // falha de processamento devolve 500 para o provedor reenviar; o evento já está gravado
      return NextResponse.json({ ...result, correlationId }, { status: result.status === 'failed' ? 500 : 200 });
    }

    // Login para clientes da API: devolve o mesmo cookie de sessão httpOnly usado pelo site.
    if (path === 'session' && req.method === 'POST') {
      const b = await req.json().catch(() => ({}));
      const { token, user } = await login(String(b.email ?? ''), String(b.password ?? ''));
      const res = NextResponse.json({ id: user.id, name: user.name });
      res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.env === 'production', path: '/', maxAge: 14 * 24 * 3600 });
      return res;
    }

    const route = ROUTES.find((x) => x.method === req.method && x.re.test(path));
    if (!route) throw notFound('Rota não encontrada.');
    const params = route.re.exec(path)!.slice(1);

    if (req.method !== 'GET') {
      // CSRF: sessão por cookie só aceita mutações vindas da própria origem
      const origin = req.headers.get('origin');
      if (origin && new URL(origin).host !== req.headers.get('host')) throw forbidden('Origem não permitida.');
    }
    const user = route.public ? null : await userFromSessionToken(req.cookies.get(SESSION_COOKIE)?.value);
    if (!route.public && !user) throw unauthenticated();
    const actor = user ? toActor(user) : ({ id: '', isSupport: false } as Actor);

    let body: any = {};
    let rawBody = '';
    if (req.method !== 'GET') {
      rawBody = await req.text();
      if (rawBody) {
        try { body = JSON.parse(rawBody); } catch { throw invalid('JSON inválido.'); }
        if (typeof body !== 'object' || body === null || Array.isArray(body)) throw invalid('Corpo deve ser um objeto JSON.');
      }
    }
    const idem = req.headers.get('idempotency-key');
    const c: Ctx = { actor, body, p: params, url, idem };
    let result: unknown;
    if (route.idem) {
      if (!idem || idem.length > 200) throw invalid('Cabeçalho Idempotency-Key é obrigatório nesta operação.');
      result = await withIdempotency(`${req.method} ${path}`, actor, idem, sha256(rawBody), () => route.fn(c));
    } else result = await route.fn(c);
    return NextResponse.json(result ?? { ok: true });
  } catch (e) {
    return errorResponse(e, correlationId);
  }
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH };

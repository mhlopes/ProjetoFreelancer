import { q, q1 } from '@/lib/db';
import { now, addMinutes } from '@/lib/clock';
import { config } from '@/lib/config';
import { hmac, randomToken, safeEqual } from '@/lib/crypto';
import { AppError } from '@/lib/errors';

/** Evento do provedor, já com assinatura validada. */
export type ProviderEvent = {
  id: string;
  type: 'payment.confirmed' | 'payment.failed' | 'payout.paid' | 'payout.failed';
  data: { providerRef: string; amountCents: number; currency: string };
};

/** Adaptador de pagamentos (docs/04-pagamentos.md). O provedor real é uma pendência (O02). */
export interface PaymentGateway {
  readonly name: string;
  createPayment(i: { amountCents: number; method: 'pix' | 'card'; reference: string }): Promise<{ providerRef: string }>;
  getPayment(ref: string): Promise<{ status: string; amountCents: number } | null>;
  /** Valida a assinatura sobre o corpo bruto. Lança 401 se inválida. */
  verifyWebhook(rawBody: string, signature: string | null): ProviderEvent;
  requestRefund(i: { providerRef: string; amountCents: number; reference: string }): Promise<{ providerRef: string }>;
  requestPayout(i: { amountCents: number; reference: string }): Promise<{ providerRef: string }>;
  getPayout(ref: string): Promise<{ status: string; amountCents: number } | null>;
}

export type MockScenario = 'success' | 'failure' | 'delay' | 'duplicate';

/**
 * Provedor SIMULADO: não movimenta dinheiro real. Existe somente em desenvolvimento/teste.
 * Gera eventos assinados (HMAC) como um provedor faria, para exercitar o mesmo caminho de webhook.
 */
export class MockGateway implements PaymentGateway {
  readonly name = 'mock';

  async createPayment(i: { amountCents: number; method: 'pix' | 'card'; reference: string }) {
    const ref = `mock_pay_${randomToken(10)}`;
    await q(`INSERT INTO mock_provider_objects (ref, kind, amount_cents, created_at) VALUES ($1,'payment',$2,$3)`, [ref, i.amountCents, now()]);
    return { providerRef: ref };
  }

  async getPayment(ref: string) {
    const o = await q1<{ status: string; amount_cents: number }>(`SELECT status, amount_cents FROM mock_provider_objects WHERE ref=$1 AND kind='payment'`, [ref]);
    return o ? { status: o.status, amountCents: o.amount_cents } : null;
  }

  verifyWebhook(rawBody: string, signature: string | null): ProviderEvent {
    if (!signature || !safeEqual(signature, hmac(rawBody, config.webhookSecret)))
      throw new AppError(401, 'bad_signature', 'Assinatura de webhook inválida.');
    const e = JSON.parse(rawBody) as ProviderEvent;
    if (!e?.id || !e.type || !e.data?.providerRef || !Number.isSafeInteger(e.data.amountCents))
      throw new AppError(400, 'invalid', 'Evento malformado.');
    return e;
  }

  async requestRefund(i: { providerRef: string; amountCents: number; reference: string }) {
    return { providerRef: `mock_ref_${randomToken(10)}` };
  }

  async requestPayout(i: { amountCents: number; reference: string }) {
    const ref = `mock_out_${randomToken(10)}`;
    await q(`INSERT INTO mock_provider_objects (ref, kind, amount_cents, created_at) VALUES ($1,'payout',$2,$3)`, [ref, i.amountCents, now()]);
    return { providerRef: ref };
  }

  async getPayout(ref: string) {
    const o = await q1<{ status: string; amount_cents: number }>(`SELECT status, amount_cents FROM mock_provider_objects WHERE ref=$1 AND kind='payout'`, [ref]);
    return o ? { status: o.status, amountCents: o.amount_cents } : null;
  }

  /** Assina um evento como o provedor faria. */
  sign(event: ProviderEvent): { rawBody: string; signature: string } {
    const rawBody = JSON.stringify(event);
    return { rawBody, signature: hmac(rawBody, config.webhookSecret) };
  }

  /**
   * Produz o(s) evento(s) do cenário escolhido. "delay" agenda a entrega para depois; "duplicate" entrega o
   * mesmo evento duas vezes. Retorna os envelopes assinados para o chamador entregar ao webhook.
   */
  async simulate(ref: string, scenario: MockScenario): Promise<{ rawBody: string; signature: string }[]> {
    const o = await q1<{ kind: 'payment' | 'payout'; amount_cents: number; status: string }>('SELECT * FROM mock_provider_objects WHERE ref=$1', [ref]);
    if (!o) throw new AppError(404, 'not_found', 'Objeto do provedor simulado não encontrado.');
    if (o.status !== 'pending') throw new AppError(409, 'bad_state', 'Este objeto simulado já foi resolvido.');
    const ok = scenario !== 'failure';
    const event: ProviderEvent = {
      id: `mock_evt_${randomToken(10)}`,
      type: o.kind === 'payment' ? (ok ? 'payment.confirmed' : 'payment.failed') : ok ? 'payout.paid' : 'payout.failed',
      data: { providerRef: ref, amountCents: o.amount_cents, currency: 'BRL' },
    };
    if (scenario === 'delay') {
      await q(`UPDATE mock_provider_objects SET status='scheduled', pending_event=$2, deliver_at=$3 WHERE ref=$1`, [
        ref, JSON.stringify(event), addMinutes(now(), 2),
      ]);
      return [];
    }
    await q('UPDATE mock_provider_objects SET status=$2 WHERE ref=$1', [ref, ok ? 'succeeded' : 'failed']);
    const env = this.sign(event);
    return scenario === 'duplicate' ? [env, env] : [env];
  }

  /** Job: eventos atrasados cujo horário chegou. */
  async dueDelayedEvents(): Promise<{ rawBody: string; signature: string }[]> {
    const rows = await q<{ ref: string; pending_event: ProviderEvent }>(
      `UPDATE mock_provider_objects SET status='succeeded', deliver_at=NULL WHERE status='scheduled' AND deliver_at <= $1 RETURNING ref, pending_event`,
      [now()],
    );
    return rows.map((r) => this.sign(r.pending_event));
  }
}

let mock: MockGateway | null = null;

export function getGateway(): PaymentGateway {
  if (config.paymentProvider === 'mock') {
    if (config.env === 'production') throw new Error('Gateway mock proibido em produção');
    return (mock ??= new MockGateway());
  }
  throw new Error(`Provedor de pagamento "${config.paymentProvider}" não implementado (pendência O02)`);
}

export function getMockGateway(): MockGateway {
  const g = getGateway();
  if (!(g instanceof MockGateway)) throw new AppError(403, 'forbidden', 'Simulação disponível apenas com provedor mock.');
  return g;
}

import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { requireActor } from '@/lib/session';
import { formatBRL } from '@/lib/money';
import { formatDateTime } from '@/lib/time';
import { ACCOUNT_KIND, PAYOUT_STATUS, TX_KIND } from '@/lib/labels';
import { isWorkerEligible } from '@/modules/identity';
import { getWallet, listPayouts, listWalletEntries } from '@/modules/wallet';
import { AutoRefresh, Submit } from '@/components/client';
import { Back, Badge, Empty, Hidden, Money } from '@/components/ui';
import { payoutAction } from '../actions';

export default async function Carteira() {
  const { user, actor } = await requireActor();
  const [w, entries, payouts] = await Promise.all([getWallet(actor), listWalletEntries(actor), listPayouts(actor)]);
  return (
    <>
      <AutoRefresh seconds={12} />
      <h1>Carteira</h1>
      <p className="note warn">Valores de demonstração: o provedor de pagamento é simulado e nenhum dinheiro real existe nesta carteira.</p>
      <div className="grid two">
        <section className="card">
          <h2>Ganhos disponíveis para saque</h2>
          <div className="big">{formatBRL(w.availableCents)}</div>
          {w.heldForWorkerCents > 0 && <p className="muted">+ <Money cents={w.heldForWorkerCents} /> retidos em serviços em andamento (liberados após a conclusão).</p>}
          {w.inPayoutCents > 0 && <p className="muted"><Money cents={w.inPayoutCents} /> em saque, a caminho.</p>}
        </section>
        <section className="card">
          <h2>Crédito para contratar</h2>
          <div className="big">{formatBRL(w.creditCents)}</div>
          <p className="muted">Reembolsos entram aqui e podem pagar novos serviços.</p>
          {w.heldAsClientCents > 0 && <p className="muted"><Money cents={w.heldAsClientCents} /> retidos em serviços que você contratou.</p>}
        </section>
      </div>
      {w.debtCents > 0 && (
        <section className="card note bad">
          <h2>Débito de multas: {formatBRL(w.debtCents)}</h2>
          <p>Este débito é separado do seu saldo: não é descontado automaticamente nem reduz o que você pode sacar hoje. A forma de cobrança ainda será definida. Se discordar de uma multa, peça análise ao suporte.</p>
        </section>
      )}

      <section className="card">
        <h2>Solicitar saque</h2>
        {!isWorkerEligible(user) ? (
          <p className="muted">Valide telefone e identidade em <Link href="/perfil">Conta</Link> para sacar.</p>
        ) : w.availableCents <= 0 ? (
          <p className="muted">Sem saldo disponível para saque no momento.</p>
        ) : (
          <form action={payoutAction} className="row" style={{ alignItems: 'flex-end' }}>
            <Back to="/carteira" /><Hidden name="idem" value={randomUUID()} />
            <div style={{ flex: 1 }}>
              <label htmlFor="amount">Valor (R$) <span className="hint">Até {formatBRL(w.availableCents)}. Conta de destino, prazos e tarifas dependem do provedor (a definir).</span></label>
              <input id="amount" name="amount" inputMode="decimal" required defaultValue={formatBRL(w.availableCents).replace('R$ ', '')} />
            </div>
            <Submit>Sacar</Submit>
          </form>
        )}
        {payouts.length > 0 && (
          <ul className="list" style={{ marginTop: 12 }}>
            {payouts.map((p) => (
              <li key={p.id} className="row between">
                <span><Money cents={p.amount_cents} /> <small>{formatDateTime(p.created_at)}</small></span>
                <Badge map={PAYOUT_STATUS} value={p.status} />
              </li>
            ))}
          </ul>
        )}
        {payouts.some((p) => p.status === 'processing') && <small>SIMULADO: saques em processamento são concluídos pelo suporte no console do provedor de teste.</small>}
      </section>

      <section className="card">
        <h2>Extrato</h2>
        {entries.length === 0 ? <Empty>Nenhuma movimentação ainda.</Empty> : (
          <div className="tablewrap">
            <table>
              <thead><tr><th>Data</th><th>Movimentação</th><th>Conta</th><th className="num">Valor</th></tr></thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td>{formatDateTime(e.created_at)}</td>
                    <td>{TX_KIND[e.tx_kind] ?? e.tx_kind}{e.service_title && <><br /><small>{e.service_title}</small></>}</td>
                    <td>{ACCOUNT_KIND[e.account_kind] ?? e.account_kind}</td>
                    <td className="num">{e.amount_cents > 0 ? '+' : ''}{formatBRL(e.amount_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

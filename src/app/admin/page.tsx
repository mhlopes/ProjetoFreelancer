import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireActor } from '@/lib/session';
import { formatBRL } from '@/lib/money';
import { formatDateTime } from '@/lib/time';
import { mockProviderObjects, policyOverview, reconciliation, supportQueues } from '@/modules/admin';
import { Submit } from '@/components/client';
import { Back, Hidden, Money } from '@/components/ui';
import {
  closePenaltyReviewAction, closeReportAction, reviewOrgAction, runJobsAction, simulateProviderAction, voidPenaltyAction,
} from '../actions';

const B = '/admin';

export default async function Admin() {
  const { actor } = await requireActor();
  if (!actor.isSupport) notFound(); // área de suporte não é revelada a outras contas
  const [qs, recon, mock, pol] = await Promise.all([supportQueues(actor), reconciliation(actor), mockProviderObjects(actor), policyOverview(actor)]);
  return (
    <>
      <h1>Suporte</h1>
      <p className="muted">Toda decisão exige justificativa e fica registrada na auditoria. O suporte não contorna regras do domínio.</p>

      <section className="card" id="empresas">
        <h2>Empresas</h2>
        {qs.organizations.length === 0 ? <p className="muted">Nenhuma empresa cadastrada.</p> : (
          <ul className="list">
            {qs.organizations.map((o) => (
              <li key={o.id}>
                <strong>{o.name}</strong> <span className="muted">· responsável {o.owner_name} · {formatDateTime(o.created_at)}</span> <span className={`badge ${o.approval_status === 'approved' ? 'ok' : o.approval_status === 'rejected' ? 'bad' : 'warn'}`}>{o.approval_status}</span>
                {o.approval_status === 'pending_review' && (
                  <form action={reviewOrgAction} className="row" style={{ marginTop: 6, alignItems: 'flex-end' }}>
                    <Back to={`${B}#empresas`} /><Hidden name="id" value={o.id} />
                    <div style={{ flex: 1 }}><label htmlFor={`or-${o.id}`}>Motivo da decisão</label><input id={`or-${o.id}`} name="reason" required minLength={5} /></div>
                    <Submit className="btn small" name="decision" value="approved">Aprovar</Submit>
                    <Submit className="btn small ghost danger" name="decision" value="rejected">Rejeitar</Submit>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" id="disputas">
        <h2>Disputas</h2>
        {qs.disputes.length === 0 ? <p className="muted">Nenhuma disputa.</p> : (
          <ul className="list">
            {qs.disputes.map((d) => (
              <li key={d.id} className="row between">
                <span><strong>{d.title}</strong> · <Money cents={d.funded_cents} /> retidos<br /><small>{formatDateTime(d.created_at)} — {d.reason.slice(0, 120)}</small></span>
                {d.status === 'open' ? <Link className="btn small" href={`/admin/disputas/${d.id}`}>Analisar</Link> : <span className="badge neutral">resolvida</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" id="multas">
        <h2>Multas</h2>
        {qs.penalties.length === 0 ? <p className="muted">Nenhuma multa registrada.</p> : (
          <ul className="list">
            {qs.penalties.map((p) => (
              <li key={p.id}>
                <strong>{p.user_name}</strong> · {p.kind === 'no_show' ? 'ausência' : 'cancelamento'} · <Money cents={p.amount_cents} /> · {p.settlement === 'debt' ? 'débito' : 'paga do valor retido'} · <span className={`badge ${p.status === 'valid' ? 'warn' : 'neutral'}`}>{p.status === 'valid' ? 'válida' : 'anulada'}</span>
                <br /><small>{formatDateTime(p.created_at)} — {p.reason}</small>
                {p.status === 'valid' && (
                  <form action={voidPenaltyAction} className="row" style={{ marginTop: 6, alignItems: 'flex-end' }}>
                    <Back to={`${B}#multas`} /><Hidden name="id" value={p.id} />
                    <div style={{ flex: 1 }}><label htmlFor={`pv-${p.id}`}>Justificativa da anulação</label><input id={`pv-${p.id}`} name="reason" required minLength={10} /></div>
                    <Submit className="btn small ghost">Anular multa</Submit>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        <h3 style={{ marginTop: 14 }}>Análises por três multas válidas em 12 meses</h3>
        <p className="muted">Não há suspensão nem banimento automático: a decisão é sempre humana.</p>
        {qs.penaltyReviews.length === 0 ? <p className="muted">Nenhuma análise aberta.</p> : (
          <ul className="list">
            {qs.penaltyReviews.map((r) => (
              <li key={r.id}>
                <strong>{r.user_name}</strong> · {r.valid_count} multas válidas no total · <span className={`badge ${r.status === 'open' ? 'warn' : 'neutral'}`}>{r.status === 'open' ? 'aberta' : `encerrada: ${r.decision === 'blocked' ? 'conta bloqueada' : 'sem ação'}`}</span>
                {r.status === 'open' && (
                  <form action={closePenaltyReviewAction} className="row" style={{ marginTop: 6, alignItems: 'flex-end' }}>
                    <Back to={`${B}#multas`} /><Hidden name="id" value={r.id} />
                    <div style={{ flex: 1 }}><label htmlFor={`pr-${r.id}`}>Justificativa</label><input id={`pr-${r.id}`} name="note" required minLength={10} /></div>
                    <Submit className="btn small ghost" name="decision" value="no_action">Encerrar sem ação</Submit>
                    <Submit className="btn small danger" name="decision" value="blocked">Bloquear conta</Submit>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" id="denuncias">
        <h2>Denúncias</h2>
        {qs.reports.length === 0 ? <p className="muted">Nenhuma denúncia.</p> : (
          <ul className="list">
            {qs.reports.map((r) => (
              <li key={r.id}>
                <strong>{r.reason}</strong> · {r.reporter_name} denunciou {r.target_name} · <span className={`badge ${r.status === 'open' ? 'warn' : 'neutral'}`}>{r.status === 'open' ? 'aberta' : 'encerrada'}</span>
                <br /><small>{formatDateTime(r.created_at)}{r.details && ` — ${r.details}`}</small>
                {r.status === 'open' && (
                  <form action={closeReportAction} className="row" style={{ marginTop: 6, alignItems: 'flex-end' }}>
                    <Back to={`${B}#denuncias`} /><Hidden name="id" value={r.id} />
                    <div style={{ flex: 1 }}><label htmlFor={`rp-${r.id}`}>Encaminhamento</label><input id={`rp-${r.id}`} name="note" required minLength={5} /></div>
                    <Submit className="btn small ghost">Encerrar</Submit>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" id="conciliacao">
        <h2>Conciliação <span className={`badge ${recon.ok ? 'ok' : 'bad'}`}>{recon.ok ? 'sem divergências' : 'DIVERGÊNCIA'}</span></h2>
        <p className="muted">Compara o provedor <strong>simulado</strong> com o ledger. Não representa dinheiro real.</p>
        <div className="tablewrap">
          <table>
            <thead><tr><th></th><th className="num">Provedor ({recon.provider.name})</th><th className="num">Ledger</th></tr></thead>
            <tbody>
              <tr><td>Recebido</td><td className="num">{formatBRL(recon.provider.receivedCents)}</td><td className="num">{formatBRL(recon.ledger.receivedCents)}</td></tr>
              <tr><td>Pago em saques</td><td className="num">{formatBRL(recon.provider.paidOutCents)}</td><td className="num">{formatBRL(recon.ledger.paidOutCents)}</td></tr>
            </tbody>
          </table>
        </div>
        <p>Soma de todos os lançamentos: <strong>{formatBRL(recon.health.totalCents)}</strong> (deve ser zero) · transações desbalanceadas: {recon.health.unbalancedTransactions} · contas com cache divergente: {recon.health.cacheDrift} · eventos de provedor não processados: {recon.pendingEvents}</p>
        <details>
          <summary>Saldos por tipo de conta</summary>
          <table><tbody>{recon.health.byKind.map((k) => <tr key={k.kind}><td>{k.kind}</td><td className="num">{formatBRL(k.total)}</td></tr>)}</tbody></table>
        </details>
        {qs.failedEvents.length > 0 && (
          <>
            <h3>Fila de falhas de webhook</h3>
            <ul className="list">{qs.failedEvents.map((e) => <li key={e.id}><code>{e.event_id}</code> · {e.type} · {e.status} · {e.attempts} tentativas<br /><small>{e.error}</small></li>)}</ul>
          </>
        )}
      </section>

      <section className="card" id="provedor">
        <h2>Provedor de teste (SIMULADO)</h2>
        <p className="muted">Console do provedor simulado: resolva saques em processamento e teste falhas. Só existe fora de produção.</p>
        <form action={runJobsAction} className="field"><Back to={`${B}#provedor`} /><Submit className="btn ghost small">Executar jobs agora (expirações, prazos de 24h, eventos atrasados)</Submit></form>
        {mock.length === 0 ? <p className="muted">Nenhuma operação.</p> : (
          <div className="tablewrap">
            <table>
              <thead><tr><th>Tipo</th><th>Referência</th><th className="num">Valor</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                {mock.map((m) => (
                  <tr key={m.ref}>
                    <td>{m.kind === 'payout' ? 'Saque' : 'Pagamento'}</td><td><code>{m.ref.slice(0, 18)}…</code></td><td className="num">{formatBRL(m.amount_cents)}</td><td>{m.status}</td>
                    <td>
                      {m.status === 'pending' && m.kind === 'payout' && (
                        <form action={simulateProviderAction} className="row">
                          <Back to={`${B}#provedor`} /><Hidden name="ref" value={m.ref} />
                          <Submit className="btn small" name="scenario" value="success">Pagar</Submit>
                          <Submit className="btn small ghost" name="scenario" value="failure">Falhar</Submit>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card" id="politicas">
        <h2>Políticas vigentes <span className="badge warn">{pol.status}</span></h2>
        <p className="note warn">Parâmetros demonstrativos. Comissão {pol.feeConfigured ? `configurada: ${pol.policy.platformFeeBps / 100}%` : 'NÃO definida (0% sintético)'}; percentuais e tetos de multa aguardam ratificação. Produção recusa iniciar com estes valores.</p>
        <dl className="kv">
          <dt>Versão</dt><dd>{pol.policy.version}</dd>
          <dt>Expiração de pedido urgente</dt><dd>{pol.policy.requestExpiryHours}h</dd>
          <dt>Confirmação de conclusão</dt><dd>{pol.policy.completionConfirmationHours}h</dd>
          <dt>Reserva durante pagamento</dt><dd>{pol.policy.fundingReservationMinutes} min</dd>
          <dt>Multa de cancelamento</dt><dd>{pol.policy.cancellationPenaltyBps / 100}% · teto {formatBRL(pol.policy.cancellationCapCents)}</dd>
          <dt>Multa de ausência</dt><dd>{pol.policy.noShowPenaltyBps / 100}% · teto {formatBRL(pol.policy.noShowCapCents)}</dd>
          <dt>Análise por multas</dt><dd>{pol.policy.penaltyReviewCount} válidas em {pol.policy.penaltyLookbackCalendarMonths} meses</dd>
          <dt>Matching</dt><dd>grupos de {pol.policy.matchingBatchSize} a cada {pol.policy.matchingBatchIntervalSeconds}s, raio inicial {pol.policy.matchingInitialRadiusKm} km</dd>
          <dt>Flags</dt><dd>transporte: {String(pol.features.transport)} · segurança: {String(pol.features.security)} · entregas: {String(pol.features.delivery)} · premium: desligado</dd>
        </dl>
      </section>

      <section className="card" id="auditoria">
        <h2>Auditoria recente</h2>
        {qs.audits.length === 0 ? <p className="muted">Sem registros.</p> : (
          <div className="tablewrap">
            <table>
              <thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Motivo</th></tr></thead>
              <tbody>{qs.audits.map((a) => <tr key={a.id}><td>{formatDateTime(a.created_at)}</td><td>{a.actor_name ?? 'sistema'}</td><td>{a.action}<br /><small>{a.resource_type}</small></td><td>{a.reason}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

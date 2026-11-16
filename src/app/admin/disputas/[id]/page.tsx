import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireActor } from '@/lib/session';
import { formatBRL } from '@/lib/money';
import { formatDateTime, formatDuration } from '@/lib/time';
import { getDisputeForSupport } from '@/modules/admin';
import { getContractForSupport } from '@/modules/contracts';
import { amountDue } from '@/modules/settlement';
import { Submit } from '@/components/client';
import { Back, Hidden, Money } from '@/components/ui';
import { resolveDisputeAction } from '../../../actions';

export default async function DisputaSuporte({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor } = await requireActor();
  if (!actor.isSupport) notFound();
  const { dispute: d, events } = await getDisputeForSupport(actor, id).catch(() => notFound());
  // acesso ao conteúdo do caso é registrado na auditoria com o motivo
  const rec = await getContractForSupport(actor, d.contract_id, `Análise da disputa ${d.id}`);
  const name = (uid: string) => rec.names.find((n) => n.id === uid)?.name ?? '—';
  const due = amountDue(rec.contract, rec.unit);
  const back = `/admin/disputas/${d.id}`;
  return (
    <>
      <p><Link href="/admin#disputas">← Suporte</Link></p>
      <section className="card">
        <h1>Disputa — {rec.request.title}</h1>
        <p className="muted">Seu acesso a este caso (conversa e registros) foi registrado na auditoria.</p>
        <dl className="kv">
          <dt>Contratante</dt><dd>{name(rec.contract.client_id)}</dd>
          <dt>Profissional</dt><dd>{name(rec.contract.worker_id)}</dd>
          <dt>Aberta por</dt><dd>{name(d.opened_by)} em {formatDateTime(d.created_at)}</dd>
          <dt>Motivo</dt><dd>{d.reason}</dd>
          <dt>Valor retido nesta parcela</dt><dd><Money cents={rec.unit.funded_cents} /></dd>
          <dt>Cobrança</dt><dd>{rec.contract.billing_unit === 'hour' ? `${formatBRL(rec.contract.amount_cents)}/h · horas informadas: ${rec.unit.reported_minutes ? formatDuration(rec.unit.reported_minutes) : '—'}${rec.unit.pending_correction_minutes != null ? ` · correção do contratante: ${formatDuration(rec.unit.pending_correction_minutes)}` : ''}` : 'preço fechado'}</dd>
          <dt>Resumo da conclusão</dt><dd>{rec.unit.summary ?? '—'}</dd>
          <dt>Escopo acordado</dt><dd>{rec.unit.scope}</dd>
        </dl>
      </section>

      <section className="card">
        <h2>Conversa do contrato</h2>
        {rec.messages.length === 0 ? <p className="muted">Sem mensagens.</p> : (
          <ul className="list">{rec.messages.map((m, i) => <li key={i}><strong>{name(m.sender_id)}</strong> <small>{formatDateTime(m.created_at)}</small><div>{m.body}</div></li>)}</ul>
        )}
        {rec.logs.length > 0 && (
          <>
            <h3 style={{ marginTop: 12 }}>Registros de horas</h3>
            <ul className="list">{rec.logs.map((l, i) => <li key={i}>{new Date(l.work_date).toLocaleDateString('pt-BR', { timeZone: 'UTC' })} · {formatDuration(l.minutes)} {l.note && `— ${l.note}`}</li>)}</ul>
          </>
        )}
      </section>

      <section className="card">
        <h2>Histórico</h2>
        <ul className="list">{events.map((e, i) => <li key={i}><strong>{e.kind}</strong> · {e.actor_name} · <small>{formatDateTime(e.created_at)}</small><div>{e.note}</div></li>)}</ul>
      </section>

      {d.status === 'open' ? (
        <section className="card">
          <h2>Resolver</h2>
          <p className="muted">Só o valor retido desta parcela é movimentado. Outras parcelas e valores já liberados não são afetados.</p>
          <form action={resolveDisputeAction}>
            <Back to={back} /><Hidden name="id" value={d.id} />
            <fieldset>
              <legend>Decisão</legend>
              <label className="check"><input type="radio" name="resolution" value="release" required />Liberar ao profissional ({formatBRL(rec.unit.reported_minutes != null || rec.contract.billing_unit === 'fixed' ? due.dueCents : rec.unit.funded_cents)})</label>
              <label className="check"><input type="radio" name="resolution" value="refund" />Reembolsar integralmente o contratante ({formatBRL(rec.unit.funded_cents)} em crédito de carteira)</label>
              <label className="check"><input type="radio" name="resolution" value="partial" />Dividir — informar abaixo o valor bruto do profissional</label>
            </fieldset>
            <div className="field"><label htmlFor="workerAmount">Valor do profissional na divisão (R$)</label><input id="workerAmount" name="workerAmount" inputMode="decimal" placeholder="somente para divisão" /></div>
            <div className="field"><label htmlFor="note">Justificativa (visível às partes)</label><textarea id="note" name="note" required minLength={10} /></div>
            <Submit>Registrar decisão</Submit>
          </form>
        </section>
      ) : (
        <section className="card"><h2>Resolvida</h2><p>{d.resolution} — profissional: {formatBRL(d.worker_cents ?? 0)}. {d.resolution_note}</p></section>
      )}
    </>
  );
}

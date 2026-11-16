import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireActor } from '@/lib/session';
import { now } from '@/lib/clock';
import { AppError } from '@/lib/errors';
import { formatBRL } from '@/lib/money';
import { formatDateTime, formatDuration } from '@/lib/time';
import { CONTRACT_STATUS, PAYMENT_MODE, UNIT_STATUS } from '@/lib/labels';
import { evaluateCancellation } from '@/modules/cancellations';
import { getContractForViewer } from '@/modules/contracts';
import { getReviewState } from '@/modules/reviews';
import { amountDue } from '@/modules/settlement';
import { AutoRefresh, Countdown, Submit } from '@/components/client';
import { Back, Badge, Hidden, Money } from '@/components/ui';
import {
  addWorkLogAction, approveUnitAction, cancelContractAction, cashConfirmAction, correctionAction, departureAction, disputeAction,
  noShowAction, respondCorrectionAction, reviewAction, startPaymentAction, startWorkAction, submitCompletionAction,
} from '../../actions';

const STEPS: [string, string][] = [
  ['awaiting_funding', 'Pagamento'], ['confirmed', 'Contratado'], ['en_route', 'A caminho'], ['in_progress', 'Em andamento'],
  ['completion_requested', 'Conclusão'], ['completed', 'Concluído'],
];
const RESOLUTION: Record<string, string> = { release: 'liberação ao profissional', refund: 'reembolso ao contratante', partial: 'divisão do valor' };

export default async function Contrato({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor } = await requireActor();
  const v = await getContractForViewer(actor, id).catch((e) => { if (e instanceof AppError && e.status === 404) notFound(); throw e; });
  const { contract: c, unit: u, role } = v;
  const back = `/contratos/${c.id}`;
  const isClient = role === 'client', isWorker = role === 'worker';
  const cash = c.payment_mode === 'cash';
  const hourly = c.billing_unit === 'hour';
  const otherId = isClient ? c.worker_id : c.client_id;
  const otherName = isClient ? v.workerName : v.clientName;
  const preview = evaluateCancellation(c, u, role, now());
  const reviews = c.status === 'completed' ? await getReviewState(actor, c.id) : null;
  const loggedMinutes = v.logs.reduce((s, l) => s + l.minutes, 0);
  const stepIdx = STEPS.findIndex(([s]) => s === c.status);
  const due = u.status === 'submitted' || u.status === 'disputed' ? amountDue(c, u) : null;
  const iConfirmedCash = v.cashConfirmedBy.includes(actor.id);

  return (
    <>
      <AutoRefresh seconds={10} />
      <p><Link href="/contratos">← {isClient ? 'Contratos' : 'Trabalhos'}</Link></p>
      <section className="card">
        <div className="row between">
          <h1 style={{ margin: 0 }}>{v.request.title}</h1>
          <Badge map={CONTRACT_STATUS} value={c.status} />
        </div>
        <p className="muted">{v.request.category_name} · {isClient ? 'Profissional' : 'Contratante'}: <Link href={`/u/${otherId}`}>{otherName}</Link></p>
        {c.status !== 'cancelled' && (
          <ol className="steps" aria-label="Etapas do contrato">
            {STEPS.filter(([s]) => !(cash && s === 'awaiting_funding')).map(([s, label]) => {
              const i = STEPS.findIndex(([x]) => x === s);
              return <li key={s} className={i < stepIdx ? 'done' : ''} aria-current={i === stepIdx ? 'step' : undefined}>{label}</li>;
            })}
          </ol>
        )}
        <dl className="kv">
          <dt>Escopo acordado</dt><dd>{u.scope}</dd>
          <dt>Valor deste contrato</dt>
          <dd>{hourly ? <><Money cents={c.amount_cents} />/h · teto autorizado <Money cents={c.budget_cents} /> ({formatDuration(v.request.duration_minutes)})</> : <Money cents={c.budget_cents} />}</dd>
          <dt>Pagamento</dt><dd>{PAYMENT_MODE[c.payment_mode]} · <Badge map={UNIT_STATUS} value={u.status} /></dd>
          <dt>Quando</dt><dd>{formatDateTime(c.starts_at, c.timezone)} até {formatDateTime(c.ends_at, c.timezone)}</dd>
          <dt>Endereço</dt>
          <dd>{v.location
            ? <>{v.location.street}, {v.location.number} {v.location.complement} — {v.request.area}, {v.request.city}/{v.request.uf}{v.location.reference && ` (${v.location.reference})`}</>
            : <>{v.request.area}, {v.request.city}/{v.request.uf} <span className="muted">— endereço completo liberado após a confirmação</span></>}</dd>
          {v.request.materials && <><dt>Materiais e despesas</dt><dd>{v.request.materials}</dd></>}
        </dl>
        {v.conversationId && <Link className="btn ghost small" href={`/mensagens/${v.conversationId}`}>Abrir conversa</Link>}
      </section>

      {/* ── Pagamento pendente ── */}
      {c.status === 'awaiting_funding' && (
        <section className="card">
          <h2>{isClient ? 'Conclua o pagamento' : 'Aguardando pagamento do contratante'}</h2>
          <p className="note warn">
            Ainda <strong>não há contratação confirmada</strong>. A vaga e a agenda estão reservadas por{' '}
            {v.holdExpiresAt ? <strong><Countdown until={v.holdExpiresAt.toISOString()} expiredText="instantes (reserva expirando)" /></strong> : 'pouco tempo'}.
            {' '}Só a confirmação do provedor de pagamento confirma o contrato.
          </p>
          {isClient && (
            <div className="row">
              {v.pendingPayment && <Link className="btn" href={`/pagamentos/${v.pendingPayment.id}`}>Continuar pagamento ({PAYMENT_MODE[v.pendingPayment.method]})</Link>}
              {(['pix', 'card'] as const).filter((m) => m !== v.pendingPayment?.method).map((m) => (
                <form key={m} action={startPaymentAction}><Back to={back} /><Hidden name="contractId" value={c.id} /><Hidden name="method" value={m} /><Submit className="btn ghost">Pagar com {PAYMENT_MODE[m]}</Submit></form>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Execução ── */}
      {(c.status === 'confirmed' || c.status === 'en_route') && (
        <section className="card">
          <h2>Execução</h2>
          {isWorker ? (
            <>
              <p>{cash ? 'Pagamento em dinheiro, combinado diretamente com o contratante.' : 'O pagamento está retido pela plataforma e será liberado após a conclusão.'}</p>
              <div className="row">
                {c.status === 'confirmed' && <form action={departureAction}><Back to={back} /><Hidden name="contractId" value={c.id} /><Submit className="btn ghost">Estou a caminho</Submit></form>}
                <form action={startWorkAction}><Back to={back} /><Hidden name="contractId" value={c.id} /><Submit>Iniciar serviço</Submit></form>
              </div>
            </>
          ) : (
            <p>{c.status === 'en_route' ? 'O profissional registrou que está a caminho.' : 'Profissional contratado. Ele registrará o deslocamento e o início do serviço.'}</p>
          )}
        </section>
      )}

      {c.status === 'in_progress' && (
        <section className="card">
          <h2>Serviço em andamento</h2>
          {hourly && (
            <>
              <h3>Horas registradas: {formatDuration(loggedMinutes) || '0'} de {formatDuration(v.request.duration_minutes)} autorizadas</h3>
              {loggedMinutes > v.request.duration_minutes && <p className="note warn">As horas registradas passam do teto pago. O excedente <strong>não é cobrado automaticamente</strong>: exige novo acordo ou análise do suporte.</p>}
              {v.logs.length > 0 && <ul className="list" style={{ marginBottom: 10 }}>{v.logs.map((l) => <li key={l.id}>{new Date(l.work_date).toLocaleDateString('pt-BR', { timeZone: 'UTC' })} · {formatDuration(l.minutes)} {l.note && <small>— {l.note}</small>}</li>)}</ul>}
              {isWorker && (
                <form action={addWorkLogAction}>
                  <Back to={back} /><Hidden name="unitId" value={u.id} />
                  <div className="grid three">
                    <div className="field"><label htmlFor="date">Data</label><input id="date" name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></div>
                    <div className="field"><label htmlFor="hours">Horas</label><input id="hours" name="hours" type="number" min={0} max={24} required defaultValue={1} /></div>
                    <div className="field"><label htmlFor="minutes">Minutos</label><input id="minutes" name="minutes" type="number" min={0} max={59} defaultValue={0} /></div>
                  </div>
                  <div className="field"><label htmlFor="note">Observação</label><input id="note" name="note" maxLength={500} /></div>
                  <Submit className="btn ghost">Registrar horas</Submit>
                </form>
              )}
              <hr />
            </>
          )}
          {isWorker ? (
            <form action={submitCompletionAction}>
              <Back to={back} /><Hidden name="unitId" value={u.id} />
              <div className="field"><label htmlFor="summary">Resumo do que foi executado</label><textarea id="summary" name="summary" required minLength={10} /></div>
              <p className="muted">{cash
                ? 'Depois, você e o contratante confirmam a conclusão e o pagamento em dinheiro.'
                : `Ao registrar, o contratante tem ${c.policy_snapshot.completionConfirmationHours}h para confirmar ou contestar. Sem resposta, o pagamento é liberado.`}</p>
              <Submit>Registrar conclusão</Submit>
            </form>
          ) : (
            <p>O profissional está executando o serviço. {!cash && `Quando ele registrar a conclusão, você terá ${c.policy_snapshot.completionConfirmationHours}h para confirmar ou contestar; sem resposta, o pagamento é liberado automaticamente.`}</p>
          )}
        </section>
      )}

      {/* ── Conclusão digital ── */}
      {u.status === 'submitted' && due && (
        <section className="card">
          <h2>Conclusão registrada</h2>
          <p><strong>Resumo do profissional:</strong> {u.summary}</p>
          <dl className="kv">
            {hourly && <><dt>Horas informadas</dt><dd>{formatDuration(u.reported_minutes ?? 0)} × {formatBRL(c.amount_cents)}/h</dd></>}
            <dt>Valor a liberar</dt><dd><Money cents={due.dueCents} /></dd>
            {u.funded_cents - due.dueCents > 0 && <><dt>Volta para a carteira do contratante</dt><dd><Money cents={u.funded_cents - due.dueCents} /></dd></>}
            <dt>Prazo para confirmar ou contestar</dt><dd>{formatDateTime(u.deadline_at, c.timezone)} — faltam <strong><Countdown until={u.deadline_at!.toISOString()} expiredText="0 min (liberação automática em andamento)" /></strong></dd>
          </dl>
          {due.excessCents > 0 && <p className="note warn">As horas informadas equivalem a {formatBRL(due.dueCents + due.excessCents)}, acima do teto pago. A diferença de {formatBRL(due.excessCents)} <strong>não é cobrada automaticamente</strong>: depende de novo acordo e pagamento, ou de análise do suporte.</p>}
          {u.pending_correction_minutes != null && (
            <div className="note warn">
              <p>O contratante corrigiu as horas para <strong>{formatDuration(u.pending_correction_minutes)}</strong>. Enquanto a correção estiver pendente, não há liberação automática.</p>
              {isWorker && (
                <div className="row">
                  <form action={respondCorrectionAction}><Back to={back} /><Hidden name="unitId" value={u.id} /><Hidden name="accept" value="1" /><Submit>Aceitar correção</Submit></form>
                  <form action={respondCorrectionAction}><Back to={back} /><Hidden name="unitId" value={u.id} /><Hidden name="accept" value="0" /><Submit className="btn ghost danger">Recusar e acionar o suporte</Submit></form>
                </div>
              )}
            </div>
          )}
          {isClient && u.pending_correction_minutes == null && (
            <>
              <form action={approveUnitAction} style={{ marginBottom: 10 }}><Back to={back} /><Hidden name="unitId" value={u.id} /><Submit>Confirmar conclusão e liberar pagamento</Submit></form>
              {hourly && (
                <details>
                  <summary>Corrigir horas</summary>
                  <form action={correctionAction}>
                    <Back to={back} /><Hidden name="unitId" value={u.id} />
                    <div className="grid two">
                      <div className="field"><label htmlFor="chours">Horas</label><input id="chours" name="hours" type="number" min={0} max={300} required /></div>
                      <div className="field"><label htmlFor="cminutes">Minutos</label><input id="cminutes" name="minutes" type="number" min={0} max={59} defaultValue={0} /></div>
                    </div>
                    <Submit className="btn ghost">Enviar correção ao profissional</Submit>
                  </form>
                </details>
              )}
            </>
          )}
          {isWorker && u.pending_correction_minutes == null && <p className="muted">Aguardando o contratante. Sem resposta até o prazo, o valor é liberado automaticamente.</p>}
          <details>
            <summary>Contestar</summary>
            <form action={disputeAction}>
              <Back to={back} /><Hidden name="unitId" value={u.id} />
              <div className="field"><label htmlFor="reason">O que aconteceu? <span className="hint">O valor fica bloqueado até a análise do suporte.</span></label><textarea id="reason" name="reason" required minLength={10} /></div>
              <Submit className="btn danger">Abrir contestação</Submit>
            </form>
          </details>
        </section>
      )}

      {/* ── Conclusão em dinheiro ── */}
      {cash && c.status === 'completion_requested' && (
        <section className="card">
          <h2>Confirmar conclusão e pagamento em dinheiro</h2>
          <p><strong>Resumo do profissional:</strong> {u.summary}</p>
          <p>Valor combinado: <Money cents={c.budget_cents} /> — pago diretamente, fora da plataforma. Não há saldo digital nem comissão de serviço neste contrato.</p>
          {iConfirmedCash
            ? <p className="note info">Você já confirmou. Falta a confirmação da outra parte.</p>
            : <form action={cashConfirmAction}><Back to={back} /><Hidden name="contractId" value={c.id} /><Submit>{isClient ? 'Confirmo: serviço concluído e pago em dinheiro' : 'Confirmo: serviço concluído e recebi em dinheiro'}</Submit></form>}
        </section>
      )}

      {/* ── Disputa ── */}
      {v.dispute && (
        <section className="card">
          <h2>Contestação</h2>
          <p><strong>{v.dispute.opened_by === actor.id ? 'Você abriu' : 'A outra parte abriu'}:</strong> {v.dispute.reason}</p>
          {v.dispute.status === 'open'
            ? <p className="note bad">Em análise pelo suporte. O valor desta parcela ({formatBRL(u.funded_cents)}) está bloqueado e não será liberado automaticamente.</p>
            : <p className="note info">Resolvida pelo suporte: {RESOLUTION[v.dispute.resolution ?? ''] ?? v.dispute.resolution}. {v.dispute.resolution_note}</p>}
        </section>
      )}

      {/* ── Resultado ── */}
      {(u.status === 'released' || u.status === 'resolved') && (
        <section className="card">
          <h2>Resumo financeiro</h2>
          <dl className="kv">
            <dt>Valor pago e retido</dt><dd><Money cents={u.funded_cents} /></dd>
            <dt>Liberado ao profissional</dt><dd><Money cents={u.released_worker_cents ?? 0} /></dd>
            {(u.released_fee_cents ?? 0) > 0 && <><dt>Comissão da plataforma</dt><dd><Money cents={u.released_fee_cents!} /></dd></>}
            {(u.refunded_cents ?? 0) > 0 && <><dt>Devolvido à carteira do contratante</dt><dd><Money cents={u.refunded_cents!} /></dd></>}
          </dl>
        </section>
      )}

      {c.status === 'cancelled' && v.cancellation && (
        <section className="card">
          <h2>Cancelamento</h2>
          <p>{v.cancellation.kind === 'funding_timeout' ? 'A reserva expirou sem pagamento confirmado.' : v.cancellation.kind === 'no_show' ? 'Ausência registrada.' : v.cancellation.kind === 'dispute_refund' ? 'Encerrado pelo suporte com reembolso.' : 'Contrato cancelado.'} {v.cancellation.reason && <>Motivo: {v.cancellation.reason}</>}</p>
          {v.penalty && (
            <p className={`note ${v.penalty.status === 'valid' ? 'warn' : 'info'}`}>
              Multa de <Money cents={v.penalty.amount_cents} /> para {v.penalty.user_id === actor.id ? 'você' : 'a outra parte'}
              {v.penalty.settlement === 'debt' ? ' (registrada como débito separado)' : ' (descontada do valor retido e paga como compensação)'}
              {v.penalty.status === 'voided' ? ' — ANULADA pelo suporte.' : '. Se houver justificativa, o suporte pode analisar.'}
            </p>
          )}
        </section>
      )}

      {/* ── Avaliação ── */}
      {reviews && (
        <section className="card">
          <h2>Avaliação</h2>
          {reviews.mine ? (
            <>
              <p>Sua nota: <strong>{reviews.mine.rating}</strong> de 5{reviews.mine.comment && <> — “{reviews.mine.comment}”</>}</p>
              {reviews.published
                ? <p>Nota que você recebeu: <strong>{reviews.theirs?.rating}</strong> de 5{reviews.theirs?.comment && <> — “{reviews.theirs.comment}”</>}</p>
                : <p className="note info">Sua avaliação será publicada quando ambos avaliarem. Até lá ela fica oculta.</p>}
            </>
          ) : (
            <form action={reviewAction}>
              <Back to={back} /><Hidden name="contractId" value={c.id} />
              <p className="muted">Sua avaliação será publicada quando ambos avaliarem.</p>
              <fieldset>
                <legend>Nota geral para {otherName}</legend>
                <div className="row">{[1, 2, 3, 4, 5].map((n) => <label key={n} className="check"><input type="radio" name="rating" value={n} required />{n}</label>)}</div>
              </fieldset>
              <div className="grid three">
                {[['punctuality', 'Pontualidade'], ['quality', isClient ? 'Qualidade' : 'Clareza do pedido'], ['communication', 'Comunicação']].map(([k, label]) => (
                  <div className="field" key={k}>
                    <label htmlFor={k}>{label} (opcional)</label>
                    <select id={k} name={k} defaultValue=""><option value="">—</option>{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</select>
                  </div>
                ))}
              </div>
              <div className="field"><label htmlFor="comment">Comentário (opcional)</label><textarea id="comment" name="comment" maxLength={2000} /></div>
              <Submit>Enviar avaliação</Submit>
            </form>
          )}
        </section>
      )}

      {/* ── Cancelar / ausência ── */}
      {['awaiting_funding', 'confirmed', 'en_route', 'in_progress', 'completion_requested'].includes(c.status) && (
        <section className="card">
          <details>
            <summary>Cancelar contrato</summary>
            {preview.outcome === 'requires_support' || preview.outcome === 'not_allowed' ? (
              <p className="note info">{preview.explanation}</p>
            ) : (
              <form action={cancelContractAction}>
                <Back to={back} /><Hidden name="contractId" value={c.id} /><Hidden name="expectedPenaltyCents" value={preview.penaltyCents} /><Hidden name="policyVersion" value={preview.policyVersion} />
                <div className={`note ${preview.outcome === 'free' ? 'ok' : 'warn'}`}>
                  <p>{preview.explanation}</p>
                  <dl className="kv">
                    <dt>Multa</dt><dd><Money cents={preview.penaltyCents} />{preview.outcome === 'penalty' && <> — paga por {preview.responsible === role ? 'você' : 'outra parte'}, destinada {preview.penaltyBeneficiary === 'worker' ? 'ao profissional' : 'ao contratante'}</>}</dd>
                    {preview.fundedCents > 0 && <><dt>Crédito que volta à carteira do contratante</dt><dd><Money cents={preview.refundToClientCents} /></dd></>}
                  </dl>
                  {preview.outcome === 'penalty' && <small>Percentual e teto demonstrativos (política v{preview.policyVersion}, ainda não ratificada).</small>}
                </div>
                <div className="field"><label htmlFor="creason">Motivo</label><input id="creason" name="reason" required minLength={3} /></div>
                <Submit className="btn danger">Confirmar cancelamento</Submit>
              </form>
            )}
          </details>
          {(c.status === 'confirmed' || c.status === 'en_route') && (
            <details>
              <summary>{isClient ? 'O profissional não apareceu' : 'O contratante não está no local'}</summary>
              <p className="muted">Antes, tente contato pelo chat{c.kind === 'scheduled' ? ' a partir do horário marcado' : ''} e aguarde {c.policy_snapshot.noShowWaitMinutes} minutos. A ausência gera multa para a parte ausente, que pode pedir análise ao suporte.</p>
              <form action={noShowAction}>
                <Back to={back} /><Hidden name="contractId" value={c.id} />
                <div className="field"><label htmlFor="nsreason">Observação</label><input id="nsreason" name="reason" /></div>
                <Submit className="btn ghost danger">Registrar ausência</Submit>
              </form>
            </details>
          )}
          {(u.status === 'funded' || u.status === 'in_progress') && (
            <details>
              <summary>Tenho um problema com este serviço</summary>
              <form action={disputeAction}>
                <Back to={back} /><Hidden name="unitId" value={u.id} />
                <div className="field"><label htmlFor="preason">Descreva o problema <span className="hint">Abre uma contestação: o valor fica bloqueado até a análise do suporte. O suporte não é serviço de emergência.</span></label><textarea id="preason" name="reason" required minLength={10} /></div>
                <Submit className="btn ghost danger">Abrir contestação</Submit>
              </form>
            </details>
          )}
        </section>
      )}
    </>
  );
}

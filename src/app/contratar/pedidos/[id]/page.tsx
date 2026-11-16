import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireActor } from '@/lib/session';
import { AppError } from '@/lib/errors';
import { formatBRL, hourlyAmount } from '@/lib/money';
import { formatDateTime, formatDuration } from '@/lib/time';
import { CONTRACT_STATUS, KIND, PROPOSAL_STATUS, REQUEST_STATUS, UNIT } from '@/lib/labels';
import { conversationIdFor } from '@/modules/chat';
import { listContracts } from '@/modules/contracts';
import { currentPolicy } from '@/modules/core';
import { listProposalsForOwner } from '@/modules/proposals';
import { getRequestForViewer } from '@/modules/requests';
import { getWallet } from '@/modules/wallet';
import { AutoRefresh, Countdown, Submit } from '@/components/client';
import { CounterForm, VersionHistory } from '@/components/proposal';
import { Back, Badge, Empty, Hidden, Money } from '@/components/ui';
import {
  adjustPriceAction, approveProposalAction, cancelRequestAction, closeRequestAction, publishRequestAction, rejectProposalAction, renewRequestAction,
} from '../../../actions';

export default async function PedidoDoContratante({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor } = await requireActor();
  const view = await getRequestForViewer(actor, id).catch((e) => { if (e instanceof AppError && e.status === 404) notFound(); throw e; });
  if (view.role !== 'owner') notFound();
  const r = view.request;
  const back = `/contratar/pedidos/${r.id}`;
  const [proposals, contracts, wallet, policy] = await Promise.all([
    listProposalsForOwner(actor, r.id), listContracts(actor, 'client', r.id), getWallet(actor), currentPolicy(),
  ]);
  const seatsFree = r.seats - (r.seats_taken ?? 0);
  const liveContracts = contracts.filter((c) => c.status !== 'cancelled');
  const convs = new Map<string, string | null>();
  for (const p of proposals) convs.set(p.worker_id, await conversationIdFor(actor, r.id, p.worker_id));

  return (
    <>
      <AutoRefresh seconds={10} />
      <p><Link href="/contratar">← Meus pedidos</Link></p>
      <section className="card">
        <div className="row between">
          <h1 style={{ margin: 0 }}>{r.title}</h1>
          <Badge map={REQUEST_STATUS} value={r.status} />
        </div>
        <p className="muted">{r.category_name}{view.tags.length ? ` · ${view.tags.join(', ')}` : ''} · {KIND[r.kind]}</p>
        <p>{r.description}</p>
        <dl className="kv">
          <dt>Valor por profissional</dt><dd><Money cents={r.price_cents} /> ({UNIT[r.billing_unit]}){r.billing_unit === 'hour' && <> · teto estimado <Money cents={hourlyAmount(r.price_cents, r.duration_minutes)} /></>}</dd>
          <dt>Vagas</dt><dd>{r.seats_taken} de {r.seats} preenchidas</dd>
          {r.seats > 1 && <><dt>Total se todas as vagas fecharem</dt><dd><Money cents={(r.billing_unit === 'hour' ? hourlyAmount(r.price_cents, r.duration_minutes) : r.price_cents) * r.seats} /> <small>(estimativa; cada profissional tem contrato e valor próprios)</small></dd></>}
          <dt>Quando</dt><dd>{r.kind === 'urgent' ? 'O quanto antes' : formatDateTime(r.starts_at, r.timezone)} · duração estimada {formatDuration(r.duration_minutes)}</dd>
          <dt>Pagamento</dt><dd>{r.payment_kind === 'cash' ? 'Dinheiro físico, direto ao profissional (sem intermediação)' : 'Digital, retido até a conclusão'}</dd>
          {r.materials && <><dt>Materiais e despesas</dt><dd>{r.materials}</dd></>}
          <dt>Local público</dt><dd>{r.area}, {r.city}/{r.uf}</dd>
          <dt>Endereço privado</dt><dd>{view.location ? `${view.location.street}, ${view.location.number} ${view.location.complement}` : '—'} <small>(visível só para contratados confirmados)</small></dd>
        </dl>

        {r.status === 'draft' && (
          <>
            <p className="note info">Revise os dados. Ao publicar, profissionais compatíveis são avisados em grupos. Você só paga depois de aprovar um profissional.</p>
            <div className="row">
              <form action={publishRequestAction}><Back to={back} /><Hidden name="id" value={r.id} /><Submit>Publicar pedido</Submit></form>
              <form action={cancelRequestAction}><Back to={back} /><Hidden name="id" value={r.id} /><Submit className="btn ghost danger">Descartar</Submit></form>
            </div>
          </>
        )}
        {r.status === 'open' && (
          <p className="note info">
            Aberto a propostas — expira em <strong><Countdown until={r.expires_at!.toISOString()} expiredText="instantes" /></strong>.
            {' '}Profissionais avisados até agora: grupo {r.wave}. {seatsFree === 0 && 'Todas as vagas estão ocupadas ou reservadas.'}
          </p>
        )}
        {r.status === 'expired' && (
          <div className="note warn">
            <p>Prazo expirado: o pedido não recebe novas propostas. Contratos já confirmados não são afetados.</p>
            <form action={renewRequestAction}><Back to={back} /><Hidden name="id" value={r.id} /><Submit>Renovar por mais {policy.requestExpiryHours}h</Submit></form>
          </div>
        )}
        {(r.status === 'open' || r.status === 'expired') && (
          <>
            <details>
              <summary>Ajustar valor anunciado</summary>
              <form action={adjustPriceAction} className="row">
                <Back to={back} /><Hidden name="id" value={r.id} />
                <div style={{ flex: 1 }}><label htmlFor="price">Novo valor (R$)</label><input id="price" name="price" inputMode="decimal" required defaultValue={formatBRL(r.price_cents).replace('R$ ', '')} /></div>
                <Submit className="btn ghost">Atualizar</Submit>
              </form>
              <small>Propostas já recebidas mantêm os próprios valores.</small>
            </details>
            <div className="row">
              {liveContracts.length > 0
                ? <form action={closeRequestAction}><Back to={back} /><Hidden name="id" value={r.id} /><Submit className="btn ghost">Encerrar vagas restantes</Submit></form>
                : <form action={cancelRequestAction}><Back to={back} /><Hidden name="id" value={r.id} /><Submit className="btn ghost danger">Cancelar pedido (sem custo)</Submit></form>}
            </div>
          </>
        )}
      </section>

      {contracts.length > 0 && (
        <section className="card">
          <h2>Profissionais deste pedido</h2>
          <ul className="list">
            {contracts.map((c) => (
              <li key={c.id}>
                <Link className="item-link" href={`/contratos/${c.id}`}>
                  <div className="row between"><strong>{c.other_name}</strong><Badge map={CONTRACT_STATUS} value={c.status} /></div>
                  <div><Money cents={c.budget_cents} /> <span className="muted">— contrato individual</span></div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {r.status !== 'draft' && (
        <section className="card">
          <h2>Propostas</h2>
          {proposals.length === 0 ? (
            <Empty>{r.status === 'open' ? 'Nenhuma proposta ainda. Se não houver profissionais disponíveis na região, considere ajustar o valor ou agendar.' : 'Nenhuma proposta recebida.'}</Empty>
          ) : (
            <ul className="list">
              {proposals.map((p) => {
                const cur = p.versions[p.versions.length - 1];
                const live = p.status === 'submitted' || p.status === 'countered';
                const approvable = p.status === 'submitted' && r.status === 'open' && seatsFree > 0;
                const total = cur.billing_unit === 'hour' ? hourlyAmount(cur.amount_cents, r.duration_minutes) : cur.amount_cents;
                return (
                  <li key={p.id}>
                    <div className="row between">
                      <h3 style={{ margin: 0 }}><Link href={`/u/${p.worker_id}`}>{p.worker_name}</Link></h3>
                      <Badge map={PROPOSAL_STATUS} value={p.status} />
                    </div>
                    <VersionHistory p={p} viewerId={actor.id} tz={r.timezone} />
                    <div className="row">
                      {convs.get(p.worker_id) && <Link className="btn ghost small" href={`/mensagens/${convs.get(p.worker_id)}`}>Conversar</Link>}
                    </div>
                    {approvable && (
                      <form action={approveProposalAction} className="note ok" style={{ marginTop: 10 }}>
                        <Back to={back} />
                        <Hidden name="proposalId" value={p.id} /><Hidden name="versionId" value={cur.id} /><Hidden name="expectedRequestVersion" value={r.version} />
                        <p><strong>Aprovar {p.worker_name}</strong> pela versão {cur.version_no}: <Money cents={total} />{cur.billing_unit === 'hour' && <> (teto de {formatDuration(r.duration_minutes)} a {formatBRL(cur.amount_cents)}/h; horas a menos voltam para sua carteira)</>}</p>
                        <p><small>Valor referente a este profissional. {r.kind === 'scheduled' ? `Agenda reservada para ${formatDateTime(r.starts_at, r.timezone)}.` : 'Atendimento imediato.'}</small></p>
                        {r.payment_kind === 'cash' ? (
                          <>
                            <Hidden name="paymentMode" value="cash" />
                            <p><small>Pagamento em dinheiro, feito por você diretamente ao profissional. A plataforma não intermedeia nem retém este valor.</small></p>
                          </>
                        ) : (
                          <div className="field">
                            <label htmlFor={`pm-${p.id}`}>Forma de pagamento</label>
                            <select id={`pm-${p.id}`} name="paymentMode" defaultValue="pix">
                              <option value="pix">Pix</option>
                              <option value="card">Cartão</option>
                              <option value="wallet" disabled={wallet.creditCents < total}>Crédito da carteira ({formatBRL(wallet.creditCents)} disponível)</option>
                            </select>
                            <span className="hint">A vaga e a agenda ficam reservadas por {policy.fundingReservationMinutes} minutos enquanto você paga. A contratação só é confirmada com o pagamento.</span>
                          </div>
                        )}
                        <p><small>
                          Cancelamento: {r.kind === 'urgent'
                            ? 'gratuito antes de o profissional iniciar o deslocamento; depois há compensação.'
                            : `gratuito com mais de ${policy.scheduledFreeCancellationBeforeHours}h de antecedência ou em até ${policy.scheduledBookingGraceMinutes} min após contratar; depois há multa.`}
                          {' '}Multa demonstrativa: {policy.cancellationPenaltyBps / 100}% limitada a {formatBRL(policy.cancellationCapCents)} (valores ainda não ratificados).
                        </small></p>
                        <Submit>Aprovar e {r.payment_kind === 'cash' ? 'contratar' : 'pagar'}</Submit>
                      </form>
                    )}
                    {p.status === 'submitted' && r.status === 'open' && seatsFree <= 0 && <p className="note warn">Sem vagas livres no momento para aprovar esta proposta.</p>}
                    {p.status === 'countered' && <p className="muted">Aguardando o profissional responder à sua contraproposta.</p>}
                    {live && r.status === 'open' && (
                      <div className="row" style={{ alignItems: 'flex-start' }}>
                        <CounterForm p={p} back={back} unit={r.billing_unit} />
                        <form action={rejectProposalAction}><Back to={back} /><Hidden name="proposalId" value={p.id} /><Submit className="linkbtn">Recusar proposta</Submit></form>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </>
  );
}

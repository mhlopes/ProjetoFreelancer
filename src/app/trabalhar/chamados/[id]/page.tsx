import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireActor } from '@/lib/session';
import { AppError } from '@/lib/errors';
import { formatBRL, hourlyAmount } from '@/lib/money';
import { formatDateTime, formatDuration } from '@/lib/time';
import { KIND, PROPOSAL_STATUS, REQUEST_STATUS, UNIT } from '@/lib/labels';
import { conversationIdFor } from '@/modules/chat';
import { listContracts } from '@/modules/contracts';
import { reputation } from '@/modules/profiles';
import { listMyProposals } from '@/modules/proposals';
import { getRequestForViewer } from '@/modules/requests';
import { AutoRefresh, Countdown, Submit } from '@/components/client';
import { CounterForm, VersionHistory } from '@/components/proposal';
import { Back, Badge, Hidden, Money, Stars } from '@/components/ui';
import { agreeAction, openConversationAction, submitProposalAction, withdrawProposalAction } from '../../../actions';

export default async function Chamado({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor } = await requireActor();
  const view = await getRequestForViewer(actor, id).catch((e) => { if (e instanceof AppError && e.status === 404) notFound(); throw e; });
  const r = view.request;
  if (view.role === 'owner') notFound();
  const back = `/trabalhar/chamados/${r.id}`;
  const [proposals, convId, contracts, rep] = await Promise.all([
    listMyProposals(actor, r.id), conversationIdFor(actor, r.id, actor.id), listContracts(actor, 'worker', r.id), reputation(r.owner_id, 'client'),
  ]);
  const live = proposals.find((p) => ['submitted', 'countered', 'accepted'].includes(p.status));
  const contract = contracts.find((c) => c.status !== 'cancelled');
  const open = r.status === 'open';
  const seatsFree = r.seats - (r.seats_taken ?? 0);

  return (
    <>
      <AutoRefresh seconds={10} />
      <p><Link href="/trabalhar">← Chamados</Link></p>
      <section className="card">
        <div className="row between">
          <h1 style={{ margin: 0 }}>{r.title}</h1>
          <Badge map={REQUEST_STATUS} value={r.status} />
        </div>
        <p className="muted">{r.category_name}{view.tags.length ? ` · ${view.tags.join(', ')}` : ''} · {KIND[r.kind]}</p>
        <p>{r.description}</p>
        <dl className="kv">
          <dt>Valor anunciado</dt><dd><Money cents={r.price_cents} /> ({UNIT[r.billing_unit]}){r.billing_unit === 'hour' && <> · estimativa de <Money cents={hourlyAmount(r.price_cents, r.duration_minutes)} /></>}</dd>
          <dt>Quando</dt><dd>{r.kind === 'urgent' ? 'O quanto antes' : formatDateTime(r.starts_at, r.timezone)} · {formatDuration(r.duration_minutes)}</dd>
          <dt>Pagamento</dt><dd>{r.payment_kind === 'cash' ? 'Dinheiro físico, direto com o contratante (sem retenção nem comissão de serviço)' : 'Digital, retido pela plataforma até a conclusão'}</dd>
          {r.materials && <><dt>Materiais e despesas</dt><dd>{r.materials}</dd></>}
          <dt>Vagas</dt><dd>{seatsFree > 0 ? `${seatsFree} de ${r.seats} disponíveis` : 'todas ocupadas ou reservadas'}</dd>
          <dt>Região</dt><dd>{r.area}, {r.city}/{r.uf}</dd>
          <dt>Endereço</dt>
          <dd>{view.location
            ? <>{view.location.street}, {view.location.number} {view.location.complement} {view.location.reference && `(${view.location.reference})`}</>
            : <span className="muted">Liberado somente após a contratação confirmada.</span>}</dd>
          <dt>Contratante</dt><dd><Link href={`/u/${r.owner_id}`}>ver perfil</Link> · <Stars {...rep} /></dd>
        </dl>
        {open && <p className="muted">Recebe propostas por mais <Countdown until={r.expires_at!.toISOString()} expiredText="instantes" />.</p>}
        {contract && <p className="note ok">Você tem um contrato neste pedido. <Link href={`/contratos/${contract.id}`}>Abrir contrato</Link></p>}
        <div className="row">
          {convId
            ? <Link className="btn ghost" href={`/mensagens/${convId}`}>Conversar com o contratante</Link>
            : <form action={openConversationAction}><Back to={back} /><Hidden name="requestId" value={r.id} /><Submit className="btn ghost">Tirar dúvidas pelo chat</Submit></form>}
        </div>
      </section>

      {!live && open && seatsFree > 0 && (
        <section className="card">
          <h2>Enviar proposta</h2>
          <p className="note info">Enviar proposta não é contratação: o contratante escolhe e aprova. Você será avisado.</p>
          <form action={submitProposalAction} style={{ marginBottom: 14 }}>
            <Back to={back} /><Hidden name="requestId" value={r.id} /><Hidden name="acceptAdvertised" value="1" />
            <Submit>Aceitar o valor anunciado ({formatBRL(r.price_cents)}{r.billing_unit === 'hour' ? '/h' : ''})</Submit>
          </form>
          <details>
            <summary>Propor outro valor ou escopo</summary>
            <form action={submitProposalAction}>
              <Back to={back} /><Hidden name="requestId" value={r.id} />
              <div className="field"><label htmlFor="amount">{r.billing_unit === 'hour' ? 'Sua tarifa por hora (R$)' : 'Seu valor pelo serviço (R$)'}</label><input id="amount" name="amount" inputMode="decimal" required placeholder="120,00" /></div>
              <div className="field"><label htmlFor="scope">O que está incluso</label><textarea id="scope" name="scope" required minLength={3} placeholder="Descreva o que você fará por esse valor" /></div>
              <Submit className="btn ghost">Enviar proposta</Submit>
            </form>
          </details>
        </section>
      )}

      {proposals.map((p) => (
        <section className="card" key={p.id}>
          <div className="row between"><h2 style={{ margin: 0 }}>Sua proposta</h2><Badge map={PROPOSAL_STATUS} value={p.status} /></div>
          <VersionHistory p={p} viewerId={actor.id} tz={r.timezone} />
          {p.status === 'submitted' && <p className="muted">Aguardando a decisão do contratante. Ainda não há contratação.</p>}
          {p.status === 'countered' && open && (
            <div className="note warn">
              <p>O contratante fez uma contraproposta (versão {p.current_version}). Concordar não contrata: ele ainda precisa aprovar.</p>
              <form action={agreeAction}><Back to={back} /><Hidden name="proposalId" value={p.id} /><Hidden name="expectedVersion" value={p.current_version} /><Submit>Concordar com a versão {p.current_version}</Submit></form>
            </div>
          )}
          {(p.status === 'submitted' || p.status === 'countered') && open && (
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <CounterForm p={p} back={back} unit={r.billing_unit} />
              <form action={withdrawProposalAction}><Back to={back} /><Hidden name="proposalId" value={p.id} /><Submit className="linkbtn">Retirar proposta</Submit></form>
            </div>
          )}
        </section>
      ))}
    </>
  );
}

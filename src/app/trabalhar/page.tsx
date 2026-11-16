import Link from 'next/link';
import { requireActor } from '@/lib/session';
import { now } from '@/lib/clock';
import { formatDateTime, formatDuration } from '@/lib/time';
import { KIND, PROPOSAL_STATUS, UNIT } from '@/lib/labels';
import { isWorkerEligible } from '@/modules/identity';
import { getWorkerProfile } from '@/modules/profiles';
import { listFeedForWorker } from '@/modules/requests';
import { AutoRefresh, Submit } from '@/components/client';
import { Back, Badge, Empty, Hidden, Money } from '@/components/ui';
import { setOnlineAction } from '../actions';

export default async function Trabalhar() {
  const { user, actor } = await requireActor();
  const profile = await getWorkerProfile(actor.id);
  const eligible = isWorkerEligible(user);
  const online = !!profile?.online_until && profile.online_until > now();
  const feed = eligible && profile ? await listFeedForWorker(actor) : [];
  return (
    <>
      <AutoRefresh seconds={10} />
      <h1>Chamados</h1>
      {!eligible && <p className="note warn">Para receber e aceitar chamados, valide seu telefone e sua identidade. <Link href="/perfil">Validar agora</Link></p>}
      {!profile && <p className="note warn">Complete seu perfil profissional (serviços, cidade e raio de atendimento). <Link href="/trabalhar/perfil">Completar perfil</Link></p>}
      {eligible && profile && (
        <section className="card">
          <div className="row between">
            <div>
              <h2 style={{ margin: 0 }}>{online ? 'Aberto a trabalho no momento' : 'Indisponível para urgentes'}</h2>
              <small>{online
                ? `Recebendo chamados urgentes até ${formatDateTime(profile.online_until)}. Depois disso a disponibilidade expira sozinha.`
                : 'Chamados agendados continuam chegando conforme sua agenda.'}</small>
            </div>
            <form action={setOnlineAction}>
              <Back to="/trabalhar" /><Hidden name="online" value={online ? '0' : '1'} />
              <Submit className={online ? 'btn ghost' : 'btn'}>{online ? 'Ficar indisponível' : 'Ficar disponível agora'}</Submit>
            </form>
          </div>
          <small>Avisos chegam nesta página e em “Avisos”. Não há garantia de alerta com o navegador fechado.</small>
        </section>
      )}
      <section className="card">
        <h2>Chamados para você</h2>
        {feed.length === 0 ? (
          <Empty>{eligible && profile ? 'Nenhum chamado compatível no momento. Eles aparecem aqui conforme categoria, região e agenda.' : 'Conclua as etapas acima para começar a receber chamados.'}</Empty>
        ) : (
          <ul className="list">
            {feed.map((r) => (
              <li key={r.id}>
                <Link className="item-link" href={`/trabalhar/chamados/${r.id}`}>
                  <div className="row between">
                    <strong>{r.title}</strong>
                    <span className={`badge ${r.kind === 'urgent' ? 'warn' : 'info'}`}>{KIND[r.kind]}</span>
                  </div>
                  <div className="muted">{r.category_name} · {r.area}, {r.city} · {r.kind === 'scheduled' ? formatDateTime(r.starts_at, r.timezone) : 'agora'} · {formatDuration(r.duration_minutes)}</div>
                  <div>
                    <Money cents={r.price_cents} /> <span className="muted">({UNIT[r.billing_unit]}{r.payment_kind === 'cash' ? ', em dinheiro' : ''})</span>
                    {r.my_proposal_status && <> · <Badge map={PROPOSAL_STATUS} value={r.my_proposal_status} /></>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

import Link from 'next/link';
import { requireActor } from '@/lib/session';
import { formatDateTime } from '@/lib/time';
import { KIND, REQUEST_STATUS, UNIT } from '@/lib/labels';
import { listMyRequests } from '@/modules/requests';
import { Badge, Empty, Money } from '@/components/ui';

export default async function Contratar() {
  const { actor } = await requireActor();
  const requests = await listMyRequests(actor);
  return (
    <>
      <div className="row between" style={{ marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>Meus pedidos</h1>
        <Link className="btn" href="/contratar/pedidos/novo">Novo pedido</Link>
      </div>
      <section className="card">
        {requests.length === 0 ? (
          <Empty>Você ainda não publicou pedidos. Descreva o serviço, defina o valor por profissional e receba propostas.</Empty>
        ) : (
          <ul className="list">
            {requests.map((r) => (
              <li key={r.id}>
                <Link className="item-link" href={`/contratar/pedidos/${r.id}`}>
                  <div className="row between">
                    <strong>{r.title}</strong>
                    <Badge map={REQUEST_STATUS} value={r.status} />
                  </div>
                  <div className="muted">
                    {r.category_name} · {KIND[r.kind]}{r.kind === 'scheduled' && r.starts_at ? ` para ${formatDateTime(r.starts_at, r.timezone)}` : ''} · {r.area}, {r.city}
                  </div>
                  <div>
                    <Money cents={r.price_cents} /> <span className="muted">por profissional ({UNIT[r.billing_unit]})</span> · {r.seats_taken}/{r.seats} {r.seats === 1 ? 'vaga' : 'vagas'}
                    {r.live_proposals > 0 && <> · <span className="badge info">{r.live_proposals} {r.live_proposals === 1 ? 'proposta' : 'propostas'} em negociação</span></>}
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

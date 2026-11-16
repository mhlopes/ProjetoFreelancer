import Link from 'next/link';
import { requireActor } from '@/lib/session';
import { formatDateTime } from '@/lib/time';
import { listConversations } from '@/modules/chat';
import { Empty } from '@/components/ui';

export default async function Mensagens() {
  const { actor } = await requireActor();
  const convs = await listConversations(actor);
  return (
    <>
      <h1>Mensagens</h1>
      <section className="card">
        {convs.length === 0 ? <Empty>Nenhuma conversa. O chat começa quando há um chamado ou proposta entre vocês.</Empty> : (
          <ul className="list">
            {convs.map((c) => (
              <li key={c.id}>
                <Link className="item-link" href={`/mensagens/${c.id}`}>
                  <div className="row between"><strong>{c.other_name}</strong><small>{c.last_at ? formatDateTime(c.last_at) : ''}</small></div>
                  <div className="muted">{c.request_title}</div>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.last_body ?? 'Sem mensagens ainda'}</div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

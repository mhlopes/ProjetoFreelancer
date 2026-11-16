import Link from 'next/link';
import { q } from '@/lib/db';
import { requireActor } from '@/lib/session';
import { formatDateTime } from '@/lib/time';
import { Submit } from '@/components/client';
import { Back, Empty } from '@/components/ui';
import { markNotificationsReadAction } from '../actions';

export default async function Notificacoes() {
  const { actor } = await requireActor();
  const items = await q<{ id: string; title: string; body: string; link: string | null; read_at: Date | null; created_at: Date }>(
    'SELECT id, title, body, link, read_at, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 80', [actor.id],
  );
  return (
    <>
      <div className="row between" style={{ marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>Avisos</h1>
        {items.some((i) => !i.read_at) && <form action={markNotificationsReadAction}><Back to="/notificacoes" /><Submit className="btn ghost small">Marcar tudo como lido</Submit></form>}
      </div>
      <section className="card">
        {items.length === 0 ? <Empty>Nenhum aviso por enquanto.</Empty> : (
          <ul className="list">
            {items.map((n) => (
              <li key={n.id}>
                <div className="row between">
                  <strong>{n.link ? <Link href={n.link}>{n.title}</Link> : n.title}</strong>
                  {!n.read_at && <span className="badge info">novo</span>}
                </div>
                <div>{n.body}</div>
                <small>{formatDateTime(n.created_at)}</small>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

import Link from 'next/link';
import { requireActor } from '@/lib/session';
import { formatDateTime } from '@/lib/time';
import { CONTRACT_STATUS } from '@/lib/labels';
import { listContracts } from '@/modules/contracts';
import { Badge, Empty } from '@/components/ui';

export default async function Agenda() {
  const { user, actor } = await requireActor();
  const role = user.active_mode === 'worker' ? 'worker' : 'client';
  const all = await listContracts(actor, role);
  const upcoming = all.filter((c) => !['cancelled', 'completed'].includes(c.status)).sort((a, b) => a.starts_at.getTime() - b.starts_at.getTime());
  return (
    <>
      <h1>Agenda</h1>
      <p className="muted">{role === 'worker'
        ? 'Compromissos confirmados bloqueiam o horário: não é possível aceitar dois serviços sobrepostos. Reservas aguardando pagamento seguram o horário por tempo limitado.'
        : 'Serviços que você contratou, em ordem de data.'}</p>
      <section className="card">
        {upcoming.length === 0 ? <Empty>Nada agendado.</Empty> : (
          <ul className="list">
            {upcoming.map((c) => (
              <li key={c.id}>
                <Link className="item-link" href={`/contratos/${c.id}`}>
                  <div className="row between">
                    <strong>{formatDateTime(c.starts_at, c.timezone)} – {new Intl.DateTimeFormat('pt-BR', { timeZone: c.timezone, timeStyle: 'short' }).format(c.ends_at)}</strong>
                    <Badge map={CONTRACT_STATUS} value={c.status} />
                  </div>
                  <div>{c.title} <span className="muted">· {c.other_name} · {c.area}, {c.city}</span></div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      {role === 'worker' && <p><Link href="/trabalhar/perfil">Registrar períodos indisponíveis</Link></p>}
    </>
  );
}

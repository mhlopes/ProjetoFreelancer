import Link from 'next/link';
import { requireActor } from '@/lib/session';
import { formatDateTime } from '@/lib/time';
import { CONTRACT_STATUS, PAYMENT_MODE } from '@/lib/labels';
import { listContracts } from '@/modules/contracts';
import { Badge, Empty, Money } from '@/components/ui';

export default async function Contratos() {
  const { user, actor } = await requireActor();
  const role = user.active_mode === 'worker' ? 'worker' : 'client';
  const contracts = await listContracts(actor, role);
  return (
    <>
      <h1>{role === 'worker' ? 'Meus trabalhos' : 'Contratos'}</h1>
      <section className="card">
        {contracts.length === 0 ? (
          <Empty>{role === 'worker' ? 'Nenhum trabalho ainda. Envie propostas nos chamados que receber.' : 'Nenhum contrato ainda. Aprove um profissional em um dos seus pedidos.'}</Empty>
        ) : (
          <ul className="list">
            {contracts.map((c) => (
              <li key={c.id}>
                <Link className="item-link" href={`/contratos/${c.id}`}>
                  <div className="row between"><strong>{c.title}</strong><Badge map={CONTRACT_STATUS} value={c.status} /></div>
                  <div className="muted">{role === 'worker' ? 'Contratante' : 'Profissional'}: {c.other_name} · {formatDateTime(c.starts_at, c.timezone)} · {c.area}, {c.city}</div>
                  <div><Money cents={c.budget_cents} /> <span className="muted">· {PAYMENT_MODE[c.payment_mode]}</span></div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

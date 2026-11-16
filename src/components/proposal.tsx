import { formatBRL } from '@/lib/money';
import { formatDateTime } from '@/lib/time';
import type { ProposalWithVersions } from '@/modules/proposals';
import { Submit } from './client';
import { Back, Hidden } from './ui';
import { counterOfferAction } from '@/app/actions';

/** Histórico completo de versões: nada é sobrescrito na negociação. */
export function VersionHistory({ p, viewerId, tz }: { p: ProposalWithVersions; viewerId: string; tz: string }) {
  return (
    <ol className="list" style={{ margin: '8px 0' }}>
      {p.versions.map((v) => {
        const current = v.version_no === p.current_version;
        const byWorker = v.author_id === p.worker_id;
        return (
          <li key={v.id} style={{ padding: '6px 0' }}>
            <div className="row between">
              <span>
                <strong>v{v.version_no}</strong> · {v.author_id === viewerId ? 'você' : byWorker ? 'profissional' : 'contratante'} · <span className="money">{formatBRL(v.amount_cents)}{v.billing_unit === 'hour' ? '/h' : ''}</span>
              </span>
              {current ? <span className="badge info">versão atual</span> : <span className="badge neutral">histórico</span>}
            </div>
            <div>{v.scope}</div>
            <small>{formatDateTime(v.created_at, tz)}{v.worker_agreed_at ? ' · profissional concordou com esta versão' : ''}</small>
          </li>
        );
      })}
    </ol>
  );
}

export function CounterForm({ p, back, unit }: { p: ProposalWithVersions; back: string; unit: 'fixed' | 'hour' }) {
  const cur = p.versions[p.versions.length - 1];
  return (
    <details>
      <summary>Fazer contraproposta</summary>
      <form action={counterOfferAction}>
        <Back to={back} />
        <Hidden name="proposalId" value={p.id} />
        <Hidden name="expectedVersion" value={p.current_version} />
        <div className="field">
          <label htmlFor={`amt-${p.id}`}>{unit === 'hour' ? 'Tarifa por hora (R$)' : 'Valor do serviço (R$)'}</label>
          <input id={`amt-${p.id}`} name="amount" inputMode="decimal" required defaultValue={formatBRL(cur.amount_cents).replace('R$ ', '')} />
        </div>
        <div className="field"><label htmlFor={`scope-${p.id}`}>Escopo</label><textarea id={`scope-${p.id}`} name="scope" required minLength={3} defaultValue={cur.scope} /></div>
        <Submit className="btn ghost">Enviar contraproposta</Submit>
      </form>
    </details>
  );
}

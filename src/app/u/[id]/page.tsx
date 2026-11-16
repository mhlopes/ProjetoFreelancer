import { notFound } from 'next/navigation';
import { requireActor } from '@/lib/session';
import { AppError } from '@/lib/errors';
import { q1 } from '@/lib/db';
import { getPublicProfile } from '@/modules/profiles';
import { REPORT_REASONS } from '@/modules/trust';
import { Submit } from '@/components/client';
import { Back, Hidden, Stars } from '@/components/ui';
import { blockAction, reportAction } from '../../actions';

export default async function PerfilPublico({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor } = await requireActor();
  const p = await getPublicProfile(id).catch((e) => { if (e instanceof AppError && e.status === 404) notFound(); throw e; });
  const self = actor.id === p.id;
  const blocked = !self && !!(await q1('SELECT 1 FROM blocks WHERE blocker_id=$1 AND blocked_id=$2', [actor.id, p.id]));
  const back = `/u/${p.id}`;
  return (
    <>
      <section className="card">
        <h1>{p.name}</h1>
        <p>
          {p.identityVerified ? <span className="badge ok">Identidade validada</span> : <span className="badge neutral">Identidade não validada</span>}
          {p.profile && <span className="muted"> · {p.profile.city}/{p.profile.uf}</span>}
          <span className="muted"> · na plataforma desde {new Date(p.memberSince).getFullYear()}</span>
        </p>
        <dl className="kv">
          <dt>Como profissional</dt><dd><Stars {...p.asWorker} /></dd>
          <dt>Como contratante</dt><dd><Stars {...p.asClient} /></dd>
        </dl>
        {p.skills.length > 0 && <p><strong>Serviços:</strong> {p.skills.join(', ')}{p.tags.length > 0 && <span className="muted"> — {p.tags.join(', ')}</span>}</p>}
        {p.profile?.bio && <><h2>Sobre</h2><p>{p.profile.bio}</p></>}
        {p.profile?.experience && <><h2>Experiências</h2><p style={{ whiteSpace: 'pre-line' }}>{p.profile.experience}</p></>}
        <p className="muted">Portfólio com fotos chega em uma próxima etapa.</p>
      </section>
      <section className="card">
        <h2>Avaliações publicadas</h2>
        <p className="muted">Uma avaliação só aparece depois que as duas partes do contrato avaliam.</p>
        {p.reviews.length === 0 ? <p className="muted">Nenhuma avaliação publicada.</p> : (
          <ul className="list">
            {p.reviews.map((r, i) => (
              <li key={i}><strong>{r.rating}</strong> de 5 <span className="muted">· como {r.target_role === 'worker' ? 'profissional' : 'contratante'}</span>{r.comment && <div>“{r.comment}”</div>}</li>
            ))}
          </ul>
        )}
      </section>
      {!self && (
        <section className="card">
          <h2>Proteção</h2>
          {blocked ? <p className="muted">Você bloqueou este usuário. Desbloqueie em Conta.</p> : (
            <details>
              <summary>Bloquear</summary>
              <p className="muted">Vocês não serão mais pareados nem poderão se contratar. Contratos em andamento, mensagens e registros existentes são preservados.</p>
              <form action={blockAction}><Back to={back} /><Hidden name="targetId" value={p.id} /><Submit className="btn ghost danger">Bloquear {p.name}</Submit></form>
            </details>
          )}
          <details>
            <summary>Denunciar</summary>
            <form action={reportAction}>
              <Back to={back} /><Hidden name="targetId" value={p.id} />
              <div className="field"><label htmlFor="reason">Motivo</label><select id="reason" name="reason" required>{REPORT_REASONS.map((r) => <option key={r}>{r}</option>)}</select></div>
              <div className="field"><label htmlFor="details">O que aconteceu</label><textarea id="details" name="details" maxLength={4000} /></div>
              <p className="muted">A denúncia vai para a equipe de suporte. Em caso de risco imediato, procure os serviços de emergência — o suporte da plataforma não é atendimento de emergência.</p>
              <Submit className="btn ghost danger">Enviar denúncia</Submit>
            </form>
          </details>
        </section>
      )}
    </>
  );
}

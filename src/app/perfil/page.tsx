import Link from 'next/link';
import { requireActor } from '@/lib/session';
import { formatDateTime } from '@/lib/time';
import { isMock } from '@/lib/config';
import { isWorkerEligible, listMyOrganizations } from '@/modules/identity';
import { listMyBlocks } from '@/modules/trust';
import { Submit } from '@/components/client';
import { Back, Hidden } from '@/components/ui';
import { createOrgAction, logoutAction, requestOtpAction, unblockAction, verifyIdentityAction, verifyOtpAction } from '../actions';

const ORG: Record<string, [string, string]> = {
  pending_review: ['Em análise pelo suporte', 'warn'], approved: ['Aprovada', 'ok'], rejected: ['Rejeitada', 'bad'],
};

export default async function Perfil() {
  const { user, actor } = await requireActor();
  const [orgs, blocks] = await Promise.all([listMyOrganizations(actor), listMyBlocks(actor)]);
  return (
    <>
      <h1>Minha conta</h1>
      <section className="card">
        <h2>{user.name}</h2>
        <dl className="kv">
          <dt>E-mail</dt><dd>{user.email}</dd>
          <dt>Telefone</dt><dd>{user.phone} {user.phone_verified_at ? <span className="badge ok">Validado</span> : <span className="badge warn">Não validado</span>}</dd>
          <dt>Identidade</dt>
          <dd>{user.identity_status === 'verified' ? <span className="badge ok">Validada</span> : user.identity_status === 'failed' ? <span className="badge bad">Reprovada</span> : <span className="badge warn">Não validada</span>}</dd>
        </dl>
        <p><Link href={`/u/${user.id}`}>Ver meu perfil público</Link></p>
        {isWorkerEligible(user)
          ? <p className="note ok">Sua conta está apta a receber e aceitar chamados.</p>
          : <p className="note warn">Para <strong>trabalhar</strong> é preciso validar telefone e identidade. Contratar não exige essa etapa.</p>}
      </section>

      {!user.phone_verified_at && (
        <section className="card">
          <h2>Validar telefone</h2>
          {isMock() && <p className="muted">SIMULADO: nenhum SMS é enviado. O código de teste aparece na tela.</p>}
          <form action={requestOtpAction} className="field"><Back to="/perfil" /><Submit className="btn ghost">Receber código</Submit></form>
          <form action={verifyOtpAction}>
            <Back to="/perfil" />
            <div className="field"><label htmlFor="code">Código de 6 dígitos</label><input id="code" name="code" inputMode="numeric" pattern="[0-9]{6}" required autoComplete="one-time-code" /></div>
            <Submit>Validar telefone</Submit>
          </form>
        </section>
      )}

      {user.identity_status !== 'verified' && (
        <section className="card">
          <h2>Validar identidade</h2>
          <p className="muted">SIMULADO: não há verificador real conectado. Em produção, a checagem de documento e foto será feita por um provedor especializado; a plataforma guarda apenas a referência do resultado.</p>
          <div className="row">
            <form action={verifyIdentityAction}><Back to="/perfil" /><Hidden name="scenario" value="approve" /><Submit>Simular aprovação</Submit></form>
            <form action={verifyIdentityAction}><Back to="/perfil" /><Hidden name="scenario" value="fail" /><Submit className="btn ghost">Simular reprovação</Submit></form>
          </div>
        </section>
      )}

      <section className="card">
        <h2>Empresas</h2>
        <p className="muted">Empresas contratam serviços pontuais por um responsável. Cada empresa depende de aprovação do suporte.</p>
        {orgs.length > 0 && (
          <ul className="list" style={{ marginBottom: 12 }}>
            {orgs.map((o) => (
              <li key={o.id}>
                <strong>{o.name}</strong> <span className={`badge ${ORG[o.approval_status][1]}`}>{ORG[o.approval_status][0]}</span>
                {o.review_reason && <div className="muted">Motivo: {o.review_reason}</div>}
              </li>
            ))}
          </ul>
        )}
        <details>
          <summary>Cadastrar empresa</summary>
          <form action={createOrgAction}>
            <Back to="/perfil" />
            <div className="field"><label htmlFor="orgname">Nome da empresa</label><input id="orgname" name="name" required /></div>
            <div className="field"><label htmlFor="cnpj">CNPJ</label><input id="cnpj" name="cnpj" inputMode="numeric" required placeholder="00.000.000/0000-00" /></div>
            <Submit>Enviar para aprovação</Submit>
          </form>
        </details>
      </section>

      <section className="card">
        <h2>Usuários bloqueados</h2>
        {blocks.length === 0 ? <p className="muted">Você não bloqueou ninguém.</p> : (
          <ul className="list">
            {blocks.map((b) => (
              <li key={b.blocked_id} className="row between">
                <span>{b.name} <small>desde {formatDateTime(b.created_at)}</small></span>
                <form action={unblockAction}><Back to="/perfil" /><Hidden name="targetId" value={b.blocked_id} /><Submit className="btn ghost small">Desbloquear</Submit></form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <form action={logoutAction}><button className="btn ghost danger">Sair da conta</button></form>
    </>
  );
}

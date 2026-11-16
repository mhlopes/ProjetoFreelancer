import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireActor } from '@/lib/session';
import { AppError } from '@/lib/errors';
import { PAYMENT_MODE } from '@/lib/labels';
import { getPaymentForPayer } from '@/modules/payments';
import { AutoRefresh, Countdown, Submit } from '@/components/client';
import { Back, Hidden, Money } from '@/components/ui';
import { simulatePaymentAction } from '../../actions';

const SCENARIOS: [string, string, string][] = [
  ['success', 'Pagamento aprovado', 'O provedor envia a confirmação assinada.'],
  ['failure', 'Pagamento recusado', 'O provedor informa a falha; a reserva continua até expirar.'],
  ['delay', 'Confirmação atrasada', 'A confirmação chega em cerca de 2 minutos.'],
  ['duplicate', 'Confirmação duplicada', 'O mesmo evento chega duas vezes; só pode haver um lançamento.'],
];

export default async function Pagamento({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor } = await requireActor();
  const p = await getPaymentForPayer(actor, id).catch((e) => { if (e instanceof AppError && e.status === 404) notFound(); throw e; });
  const back = `/pagamentos/${p.id}`;
  return (
    <>
      {p.status === 'pending' && <AutoRefresh seconds={6} />}
      <section className="card" style={{ maxWidth: 560, margin: '0 auto' }}>
        <h1>Pagamento — {PAYMENT_MODE[p.method]}</h1>
        <p className="note warn"><strong>PROVEDOR SIMULADO.</strong> Esta tela substitui o checkout de um provedor real (QR Code Pix ou formulário de cartão do próprio provedor). Nenhum dinheiro é movimentado e nenhum dado de cartão é coletado.</p>
        <dl className="kv">
          <dt>Serviço</dt><dd>{p.title}</dd>
          <dt>Valor</dt><dd><span className="big"><Money cents={p.amount_cents} /></span><br /><small>Calculado pelo servidor a partir do acordo aprovado.</small></dd>
        </dl>
        {p.status === 'pending' && (
          <>
            <p>
              Aguardando a confirmação do provedor.{' '}
              {p.hold_expires_at
                ? <>A reserva da vaga vale por mais <strong><Countdown until={p.hold_expires_at.toISOString()} expiredText="0 min" /></strong>.</>
                : <strong>A reserva da vaga já expirou: se este pagamento for confirmado, o valor será devolvido como crédito na carteira.</strong>}
            </p>
            <p className="muted">A contratação só é confirmada quando o evento do provedor é validado pelo servidor — voltar a esta página não prova pagamento.</p>
            <h2>Simular resposta do provedor</h2>
            <ul className="list">
              {SCENARIOS.map(([s, label, hint]) => (
                <li key={s}>
                  <form action={simulatePaymentAction} className="row between">
                    <Back to={back} /><Hidden name="paymentId" value={p.id} /><Hidden name="scenario" value={s} />
                    <span><strong>{label}</strong><br /><small>{hint}</small></span>
                    <Submit className={s === 'success' ? 'btn small' : 'btn ghost small'}>Simular</Submit>
                  </form>
                </li>
              ))}
            </ul>
          </>
        )}
        {p.status === 'confirmed' && <p className="note ok">Pagamento confirmado pelo provedor. O valor está retido até a conclusão do serviço.</p>}
        {p.status === 'failed' && <p className="note bad">Pagamento não aprovado. Você pode tentar de novo enquanto a reserva estiver válida.</p>}
        {p.status === 'late_reconciled' && <p className="note warn">A confirmação chegou depois que a reserva expirou. Nenhuma contratação foi criada; o valor foi devolvido como crédito na sua carteira.</p>}
        <Link className="btn ghost" href={`/contratos/${p.contract_id}`}>Ir para o contrato</Link>
      </section>
    </>
  );
}

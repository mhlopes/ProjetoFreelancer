import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireActor } from '@/lib/session';
import { AppError } from '@/lib/errors';
import { formatDateTime } from '@/lib/time';
import { getConversation, listMessages } from '@/modules/chat';
import { AutoRefresh, Submit } from '@/components/client';
import { Back, Hidden } from '@/components/ui';
import { postMessageAction } from '../../actions';

export default async function Conversa({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor } = await requireActor();
  const conv = await getConversation(actor, id).catch((e) => { if (e instanceof AppError && e.status === 404) notFound(); throw e; });
  const messages = await listMessages(actor, id);
  const back = `/mensagens/${id}`;
  return (
    <>
      <AutoRefresh seconds={5} />
      <p><Link href="/mensagens">← Mensagens</Link></p>
      <section className="card">
        <h1><Link href={`/u/${conv.otherId}`}>{conv.otherName}</Link></h1>
        <p className="muted">
          Sobre: <Link href={conv.iAmClient ? `/contratar/pedidos/${conv.request_id}` : `/trabalhar/chamados/${conv.request_id}`}>{conv.requestTitle}</Link>
        </p>
        <p className="note info">Combine tudo por aqui. Evite compartilhar endereço completo, documentos ou contatos externos antes da contratação confirmada — o endereço é liberado automaticamente ao profissional contratado.</p>
        <div className="chat" aria-live="polite" aria-label="Mensagens">
          {messages.length === 0 && <p className="muted">Nenhuma mensagem ainda.</p>}
          {messages.map((m) => (
            <div key={m.id} className={`msg ${m.sender_id === actor.id ? 'mine' : ''}`}>
              <span className="skip">{m.sender_id === actor.id ? 'Você: ' : `${conv.otherName}: `}</span>
              {m.body}
              <time dateTime={m.created_at.toISOString()}>{formatDateTime(m.created_at)}</time>
            </div>
          ))}
        </div>
        <form action={postMessageAction}>
          <Back to={back} /><Hidden name="conversationId" value={id} />
          <div className="field"><label htmlFor="body">Mensagem</label><textarea id="body" name="body" required maxLength={2000} /></div>
          <Submit>Enviar</Submit>
        </form>
      </section>
    </>
  );
}

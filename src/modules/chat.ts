import { q, q1 } from '@/lib/db';
import { now } from '@/lib/clock';
import { forbidden, invalid, notFound } from '@/lib/errors';
import { isBlockedBetween, isUuid, notify, rateLimit, type Actor } from './core';
import { assertCanEngage, type ServiceRequest } from './requests';

export type Conversation = {
  id: string; request_id: string; client_id: string; worker_id: string; created_at: Date;
  request_title: string; other_name: string; last_body: string | null; last_at: Date | null;
};
export type Message = { id: number; sender_id: string; body: string; created_at: Date };

/** ACL: somente o contratante e o candidato daquela conversa. Demais candidatos não têm acesso. */
async function loadForParticipant(actor: Actor, id: string) {
  if (!isUuid(id)) throw notFound();
  const c = await q1<{ id: string; request_id: string; client_id: string; worker_id: string }>('SELECT * FROM conversations WHERE id = $1', [id]);
  if (!c || (c.client_id !== actor.id && c.worker_id !== actor.id)) throw notFound();
  return c;
}

/** Trabalhador que recebeu o chamado pode iniciar conversa antes de propor (negociação precede a contratação, R12). */
export async function openConversationAsWorker(actor: Actor, requestId: string): Promise<string> {
  if (!isUuid(requestId)) throw notFound();
  const r = await q1<ServiceRequest>('SELECT * FROM service_requests WHERE id = $1', [requestId]);
  const dispatched = r && (await q1('SELECT 1 FROM request_dispatches WHERE request_id=$1 AND worker_id=$2', [requestId, actor.id]));
  if (!r || !dispatched) throw notFound();
  await assertCanEngage(actor.id, r);
  const c = await q1<{ id: string }>(
    `INSERT INTO conversations (request_id, client_id, worker_id, created_at) VALUES ($1,$2,$3,$4)
     ON CONFLICT (request_id, worker_id) DO UPDATE SET request_id = EXCLUDED.request_id RETURNING id`,
    [requestId, r.owner_id, actor.id, now()],
  );
  return c!.id;
}

export async function getConversation(actor: Actor, id: string) {
  const c = await loadForParticipant(actor, id);
  const other = c.client_id === actor.id ? c.worker_id : c.client_id;
  const info = await q1<{ title: string; name: string }>(
    'SELECT r.title, u.name FROM service_requests r, users u WHERE r.id = $1 AND u.id = $2', [c.request_id, other],
  );
  return { ...c, otherId: other, otherName: info!.name, requestTitle: info!.title, iAmClient: c.client_id === actor.id };
}

export async function listMessages(actor: Actor, conversationId: string, afterId = 0): Promise<Message[]> {
  await loadForParticipant(actor, conversationId);
  return q<Message>(
    'SELECT id, sender_id, body, created_at FROM messages WHERE conversation_id=$1 AND id > $2 ORDER BY id LIMIT 200',
    [conversationId, Number.isSafeInteger(afterId) ? afterId : 0],
  );
}

export async function postMessage(actor: Actor, conversationId: string, bodyRaw: string): Promise<Message> {
  const body = bodyRaw.trim();
  if (!body || body.length > 2000) throw invalid('Mensagem vazia ou longa demais.');
  const c = await loadForParticipant(actor, conversationId);
  await rateLimit('chat', actor.id, 40, 60);
  // R34: bloqueio impede novos contatos, mas preserva o atendimento de contratos existentes.
  if (await isBlockedBetween(c.client_id, c.worker_id)) {
    const live = await q1(
      `SELECT 1 FROM contracts WHERE request_id=$1 AND worker_id=$2 AND status NOT IN ('cancelled','completed')`,
      [c.request_id, c.worker_id],
    );
    if (!live) throw forbidden('Não é possível enviar mensagens a este usuário.');
  }
  const m = await q1<Message>(
    'INSERT INTO messages (conversation_id, sender_id, body, created_at) VALUES ($1,$2,$3,$4) RETURNING id, sender_id, body, created_at',
    [conversationId, actor.id, body, now()],
  );
  const target = c.client_id === actor.id ? c.worker_id : c.client_id;
  // resumo sem conteúdo da mensagem; no máximo um alerta por conversa a cada 5 minutos
  await notify(target, 'chat.message', 'Nova mensagem', 'Você recebeu uma mensagem em uma conversa.', `/mensagens/${conversationId}`,
    `chat:${conversationId}:${target}:${Math.floor(now().getTime() / 300_000)}`);
  return m!;
}

export async function listConversations(actor: Actor): Promise<Conversation[]> {
  return q<Conversation>(
    `SELECT c.*, r.title AS request_title,
            (SELECT name FROM users u WHERE u.id = CASE WHEN c.client_id = $1 THEN c.worker_id ELSE c.client_id END) AS other_name,
            lm.body AS last_body, lm.created_at AS last_at
       FROM conversations c
       JOIN service_requests r ON r.id = c.request_id
       LEFT JOIN LATERAL (SELECT body, created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY id DESC LIMIT 1) lm ON true
      WHERE c.client_id = $1 OR c.worker_id = $1
      ORDER BY COALESCE(lm.created_at, c.created_at) DESC LIMIT 100`,
    [actor.id],
  );
}

export async function conversationIdFor(actor: Actor, requestId: string, workerId: string): Promise<string | null> {
  const c = await q1<{ id: string }>(
    'SELECT id FROM conversations WHERE request_id=$1 AND worker_id=$2 AND (client_id=$3 OR worker_id=$3)', [requestId, workerId, actor.id],
  );
  return c?.id ?? null;
}

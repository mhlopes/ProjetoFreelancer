import { q, q1 } from '@/lib/db';
import { now } from '@/lib/clock';
import { invalid, notFound } from '@/lib/errors';
import { isUuid, rateLimit, type Actor } from './core';

/**
 * Bloqueio (R34): impede futuros encontros e contratações entre as duas contas. Não altera contratos existentes,
 * nem apaga mensagens, registros ou evidências.
 */
export async function blockUser(actor: Actor, targetId: string, reason = '') {
  if (!isUuid(targetId) || targetId === actor.id) throw invalid('Usuário inválido.');
  if (!(await q1('SELECT 1 FROM users WHERE id=$1', [targetId]))) throw notFound();
  await q('INSERT INTO blocks (blocker_id, blocked_id, reason, created_at) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [
    actor.id, targetId, reason.slice(0, 500), now(),
  ]);
}

export async function unblockUser(actor: Actor, targetId: string) {
  await q('DELETE FROM blocks WHERE blocker_id=$1 AND blocked_id=$2', [actor.id, targetId]);
}

export const listMyBlocks = (actor: Actor) =>
  q<{ blocked_id: string; name: string; created_at: Date }>(
    'SELECT b.blocked_id, u.name, b.created_at FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id=$1 ORDER BY b.created_at DESC', [actor.id],
  );

export const REPORT_REASONS = ['Comportamento inadequado', 'Fraude ou golpe', 'Assédio', 'Risco à segurança', 'Perfil falso', 'Outro'] as const;

/** Denúncia: vai para a fila do suporte. Só se denuncia alguém com quem houve relação (conversa ou contrato). */
export async function reportUser(actor: Actor, input: { targetUserId: string; contractId?: string | null; reason: string; details?: string }) {
  if (!isUuid(input.targetUserId) || input.targetUserId === actor.id) throw invalid('Usuário inválido.');
  if (!(REPORT_REASONS as readonly string[]).includes(input.reason)) throw invalid('Selecione um motivo.');
  await rateLimit('report', actor.id, 10, 3600);
  const related = await q1(
    `SELECT 1 FROM conversations WHERE (client_id=$1 AND worker_id=$2) OR (client_id=$2 AND worker_id=$1)
     UNION ALL SELECT 1 FROM contracts WHERE (client_id=$1 AND worker_id=$2) OR (client_id=$2 AND worker_id=$1) LIMIT 1`,
    [actor.id, input.targetUserId],
  );
  if (!related) throw notFound();
  let contractId: string | null = null;
  if (input.contractId && isUuid(input.contractId)) {
    const c = await q1('SELECT 1 FROM contracts WHERE id=$1 AND (client_id=$2 OR worker_id=$2)', [input.contractId, actor.id]);
    if (c) contractId = input.contractId;
  }
  await q('INSERT INTO reports (reporter_id, target_user_id, contract_id, reason, details, created_at) VALUES ($1,$2,$3,$4,$5,$6)', [
    actor.id, input.targetUserId, contractId, input.reason, (input.details ?? '').trim().slice(0, 4000), now(),
  ]);
}

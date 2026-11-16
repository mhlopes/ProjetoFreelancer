import { q, q1, tx } from '@/lib/db';
import { now } from '@/lib/clock';
import { conflict, invalid, notFound, rule } from '@/lib/errors';
import { isUuid, notify, type Actor } from './core';

export type Review = {
  id: string; contract_id: string; author_id: string; target_id: string; target_role: 'worker' | 'client'; rating: number;
  punctuality: number | null; quality: number | null; communication: number | null; comment: string;
  submitted_at: Date; published_at: Date | null;
};

const score = (v: unknown, required: boolean): number | null => {
  if (v == null || v === '') {
    if (required) throw invalid('Dê uma nota de 1 a 5.');
    return null;
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 5) throw invalid('Notas vão de 1 a 5.');
  return n;
};

/**
 * Uma avaliação por parte em contrato concluído (inclusive pago em espécie). A publicação é atômica e só
 * acontece quando AMBAS as partes avaliaram; não existe publicação unilateral por prazo.
 */
export async function submitReview(actor: Actor, contractId: string, input: {
  rating: unknown; punctuality?: unknown; quality?: unknown; communication?: unknown; comment?: string;
}): Promise<{ published: boolean }> {
  if (!isUuid(contractId)) throw notFound();
  const rating = score(input.rating, true)!;
  const comment = (input.comment ?? '').trim();
  if (comment.length > 2000) throw invalid('Comentário longo demais.');
  return tx(async () => {
    const c = await q1<{ id: string; client_id: string; worker_id: string; status: string }>(
      'SELECT id, client_id, worker_id, status FROM contracts WHERE id = $1 FOR UPDATE', [contractId],
    );
    if (!c || (c.client_id !== actor.id && c.worker_id !== actor.id)) throw notFound();
    if (c.status !== 'completed') throw rule('not_completed', 'A avaliação fica disponível após a conclusão do contrato.');
    if (await q1('SELECT 1 FROM reviews WHERE contract_id=$1 AND author_id=$2', [c.id, actor.id]))
      throw conflict('already_reviewed', 'Você já avaliou este contrato.');
    const iAmClient = c.client_id === actor.id;
    const target = iAmClient ? c.worker_id : c.client_id;
    const t = now();
    await q(
      `INSERT INTO reviews (contract_id, author_id, target_id, target_role, rating, punctuality, quality, communication, comment, submitted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [c.id, actor.id, target, iAmClient ? 'worker' : 'client', rating, score(input.punctuality, false), score(input.quality, false),
        score(input.communication, false), comment, t],
    );
    const n = await q1<{ c: number }>('SELECT count(*)::int AS c FROM reviews WHERE contract_id=$1', [c.id]);
    if (n!.c < 2) return { published: false }; // a contraparte não é avisada de nota nem de conteúdo
    await q('UPDATE reviews SET published_at=$2 WHERE contract_id=$1 AND published_at IS NULL', [c.id, t]);
    for (const uid of [c.client_id, c.worker_id])
      await notify(uid, 'reviews.published', 'Avaliações publicadas', 'As avaliações deste contrato agora estão visíveis.', `/contratos/${c.id}`, `reviews.published:${c.id}:${uid}`);
    return { published: true };
  });
}

/**
 * Estado das avaliações para um participante. Enquanto não publicadas, devolve SOMENTE a avaliação do próprio
 * autor: nem a existência da avaliação da contraparte é revelada.
 */
export async function getReviewState(actor: Actor, contractId: string): Promise<{ mine: Review | null; theirs: Review | null; published: boolean }> {
  const c = await q1<{ client_id: string; worker_id: string }>('SELECT client_id, worker_id FROM contracts WHERE id = $1', [contractId]);
  if (!c || (c.client_id !== actor.id && c.worker_id !== actor.id)) throw notFound();
  const mine = (await q1<Review>('SELECT * FROM reviews WHERE contract_id=$1 AND author_id=$2', [contractId, actor.id])) ?? null;
  const theirs = (await q1<Review>('SELECT * FROM reviews WHERE contract_id=$1 AND author_id<>$2 AND published_at IS NOT NULL', [contractId, actor.id])) ?? null;
  return { mine, theirs, published: !!mine?.published_at };
}

import { q, q1, tx } from '@/lib/db';
import { now, addMinutes } from '@/lib/clock';
import { config } from '@/lib/config';
import { invalid, notFound } from '@/lib/errors';
import { timezoneForUf, zonedToUtc } from '@/lib/time';
import { featureEnabled, isUuid, type Actor } from './core';
import { requireEligibleWorker } from './identity';

export type Category = {
  id: string; slug: string; name: string; feature_flag: string | null; requires_credential: boolean;
  max_radius_km: number; suggested_price_cents: number; enabled: boolean;
};
export type Tag = { id: string; category_id: string; slug: string; name: string };

/** Catálogo controlado. Categorias com flag operacional desligada aparecem como indisponíveis. */
export async function listCategories(opts: { onlyEnabled?: boolean } = {}): Promise<Category[]> {
  const rows = await q<Omit<Category, 'enabled'>>('SELECT * FROM categories ORDER BY sort');
  const all = rows.map((c) => ({ ...c, enabled: featureEnabled(c.feature_flag) }));
  return opts.onlyEnabled ? all.filter((c) => c.enabled) : all;
}

export async function getCategory(id: string): Promise<Category> {
  const c = isUuid(id) ? await q1<Omit<Category, 'enabled'>>('SELECT * FROM categories WHERE id = $1', [id]) : undefined;
  if (!c) throw invalid('Categoria inválida.');
  return { ...c, enabled: featureEnabled(c.feature_flag) };
}

export const listTags = () => q<Tag>('SELECT * FROM tags ORDER BY name');

export type WorkerProfile = {
  user_id: string; bio: string; experience: string; radius_km: number; city: string; uf: string;
  lat: number | null; lng: number | null; online_until: Date | null;
  categoryIds: string[]; tagIds: string[];
};

export async function getWorkerProfile(userId: string): Promise<WorkerProfile | null> {
  const p = await q1<WorkerProfile>('SELECT * FROM worker_profiles WHERE user_id = $1', [userId]);
  if (!p) return null;
  p.categoryIds = (await q<{ category_id: string }>('SELECT category_id FROM worker_skills WHERE user_id = $1', [userId])).map((r) => r.category_id);
  p.tagIds = (await q<{ tag_id: string }>('SELECT tag_id FROM worker_tags WHERE user_id = $1', [userId])).map((r) => r.tag_id);
  return p;
}

export async function saveWorkerProfile(actor: Actor, input: {
  bio: string; experience: string; radiusKm: number; city: string; uf: string;
  lat?: number | null; lng?: number | null; categoryIds: string[]; tagIds: string[];
}) {
  const uf = input.uf.toUpperCase();
  if (!timezoneForUf(uf)) throw invalid('UF inválida.');
  if (input.city.trim().length < 2) throw invalid('Informe sua cidade.');
  if (!Number.isInteger(input.radiusKm) || input.radiusKm < 1 || input.radiusKm > 200) throw invalid('Raio deve ficar entre 1 e 200 km.');
  if (input.bio.length > 2000 || input.experience.length > 4000) throw invalid('Texto longo demais.');
  const lat = input.lat ?? null, lng = input.lng ?? null;
  if ((lat == null) !== (lng == null) || (lat != null && (Math.abs(lat) > 90 || Math.abs(lng!) > 180))) throw invalid('Coordenadas inválidas.');
  const cats = [...new Set(input.categoryIds)].filter(isUuid);
  const tags = [...new Set(input.tagIds)].filter(isUuid);
  if (!cats.length) throw invalid('Escolha ao menos um tipo de serviço.');
  await tx(async () => {
    await q(
      `INSERT INTO worker_profiles (user_id, bio, experience, radius_km, city, uf, lat, lng, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (user_id) DO UPDATE SET bio=$2, experience=$3, radius_km=$4, city=$5, uf=$6, lat=$7, lng=$8, updated_at=$9`,
      [actor.id, input.bio.trim(), input.experience.trim(), input.radiusKm, input.city.trim(), uf, lat, lng, now()],
    );
    await q('DELETE FROM worker_tags WHERE user_id = $1', [actor.id]);
    await q('DELETE FROM worker_skills WHERE user_id = $1', [actor.id]);
    for (const c of cats) await q('INSERT INTO worker_skills (user_id, category_id) SELECT $1, id FROM categories WHERE id = $2', [actor.id, c]);
    // só aceita tags das categorias escolhidas
    for (const t of tags)
      await q(
        `INSERT INTO worker_tags (user_id, tag_id) SELECT $1, t.id FROM tags t
          JOIN worker_skills s ON s.category_id = t.category_id AND s.user_id = $1 WHERE t.id = $2`,
        [actor.id, t],
      );
  });
}

/** "Aberto a trabalho no momento": só trabalhador elegível; expira sozinho (não fica online abandonado). */
export async function setOnline(actor: Actor, online: boolean) {
  await requireEligibleWorker(actor.id);
  const p = await q1('SELECT 1 FROM worker_profiles WHERE user_id = $1', [actor.id]);
  if (!p) throw invalid('Complete seu perfil profissional antes de ficar disponível.');
  await q('UPDATE worker_profiles SET online_until = $2, updated_at = $3 WHERE user_id = $1', [
    actor.id, online ? addMinutes(now(), config.onlineWindowMinutes) : null, now(),
  ]);
}

export type AvailabilityBlock = { id: string; starts_at: Date; ends_at: Date; note: string };

export async function listAvailabilityBlocks(actor: Actor): Promise<AvailabilityBlock[]> {
  return q<AvailabilityBlock>(
    `SELECT id, lower(during) AS starts_at, upper(during) AS ends_at, note FROM availability_blocks
      WHERE worker_id = $1 AND upper(during) > $2 ORDER BY lower(during)`,
    [actor.id, now()],
  );
}

export async function addAvailabilityBlock(actor: Actor, input: { startLocal: string; endLocal: string; note?: string }) {
  const p = await q1<{ uf: string }>('SELECT uf FROM worker_profiles WHERE user_id = $1', [actor.id]);
  if (!p) throw invalid('Complete seu perfil profissional primeiro.');
  const tz = timezoneForUf(p.uf)!;
  const s = zonedToUtc(input.startLocal, tz), e = zonedToUtc(input.endLocal, tz);
  if (!s || !e || e <= s) throw invalid('Período inválido.');
  await q(`INSERT INTO availability_blocks (worker_id, during, note, created_at) VALUES ($1, tstzrange($2,$3,'[)'), $4, $5)`, [
    actor.id, s, e, (input.note ?? '').slice(0, 200), now(),
  ]);
}

export async function removeAvailabilityBlock(actor: Actor, id: string) {
  await q('DELETE FROM availability_blocks WHERE id = $1 AND worker_id = $2', [id, actor.id]);
}

export type Reputation = { count: number; average10: number | null };

/** Reputação por papel (P05). Considera apenas avaliações publicadas; média ×10 em inteiro. */
export async function reputation(userId: string, role: 'worker' | 'client'): Promise<Reputation> {
  const r = await q1<{ c: number; s: number | null }>(
    `SELECT count(*)::int AS c, sum(rating)::int AS s FROM reviews
      WHERE target_id = $1 AND target_role = $2 AND published_at IS NOT NULL`,
    [userId, role],
  );
  const count = r?.c ?? 0;
  return { count, average10: count ? Math.round(((r!.s ?? 0) * 10) / count) : null };
}

/** Perfil público: sem documento, telefone, e-mail ou localização exata. */
export async function getPublicProfile(userId: string) {
  if (!isUuid(userId)) throw notFound();
  const u = await q1<{ id: string; name: string; identity_status: string; created_at: Date }>(
    'SELECT id, name, identity_status, created_at FROM users WHERE id = $1', [userId],
  );
  if (!u) throw notFound();
  const p = await q1<{ bio: string; experience: string; city: string; uf: string }>(
    'SELECT bio, experience, city, uf FROM worker_profiles WHERE user_id = $1', [userId],
  );
  const skills = await q<{ name: string }>(
    'SELECT c.name FROM worker_skills s JOIN categories c ON c.id = s.category_id WHERE s.user_id = $1 ORDER BY c.sort', [userId],
  );
  const tags = await q<{ name: string }>('SELECT t.name FROM worker_tags w JOIN tags t ON t.id = w.tag_id WHERE w.user_id = $1 ORDER BY t.name', [userId]);
  const reviews = await q<{ rating: number; comment: string; target_role: string; published_at: Date }>(
    `SELECT rating, comment, target_role, published_at FROM reviews
      WHERE target_id = $1 AND published_at IS NOT NULL ORDER BY published_at DESC LIMIT 20`,
    [userId],
  );
  return {
    id: u.id,
    name: u.name,
    identityVerified: u.identity_status === 'verified',
    memberSince: u.created_at,
    profile: p ?? null,
    skills: skills.map((s) => s.name),
    tags: tags.map((t) => t.name),
    asWorker: await reputation(userId, 'worker'),
    asClient: await reputation(userId, 'client'),
    reviews,
  };
}

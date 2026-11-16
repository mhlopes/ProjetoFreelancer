import { q, q1, tx } from '@/lib/db';
import { now, addHours, addMinutes } from '@/lib/clock';
import { conflict, forbidden, invalid, notFound, rule } from '@/lib/errors';
import { distanceKm, timezoneForUf, zonedToUtc } from '@/lib/time';
import { currentPolicy, isBlockedBetween, isUuid, notify, type Actor } from './core';
import { getCategory } from './profiles';

export type ServiceRequest = {
  id: string; owner_id: string; organization_id: string | null; category_id: string; kind: 'urgent' | 'scheduled';
  title: string; description: string; materials: string; seats: number; price_cents: number;
  billing_unit: 'fixed' | 'hour'; payment_kind: 'digital' | 'cash'; starts_at: Date | null; duration_minutes: number;
  timezone: string; status: 'draft' | 'open' | 'closed' | 'expired' | 'cancelled'; published_at: Date | null;
  expires_at: Date | null; cycle: number; wave: number; version: number; area: string; city: string; uf: string;
  approx_lat: number | null; approx_lng: number | null; created_at: Date;
  category_name?: string; seats_taken?: number;
};
export type RequestLocation = { street: string; number: string; complement: string; reference: string };

const REQ_SELECT = `r.*, c.name AS category_name,
  (SELECT count(*)::int FROM contracts k WHERE k.request_id = r.id AND k.status <> 'cancelled') AS seats_taken`;

export type RequestInput = {
  categoryId: string; tagIds?: string[]; organizationId?: string | null; kind: 'urgent' | 'scheduled';
  title: string; description: string; materials?: string; seats: number; priceCents: number;
  billingUnit: 'fixed' | 'hour'; paymentKind: 'digital' | 'cash'; startsAtLocal?: string; durationMinutes: number;
  uf: string; city: string; area: string; street: string; number?: string; complement?: string; reference?: string;
  lat?: number | null; lng?: number | null;
};

async function assertOrganizationUsable(actor: Actor, organizationId: string | null | undefined) {
  if (!organizationId) return;
  const o = await q1<{ owner_id: string; approval_status: string }>('SELECT owner_id, approval_status FROM organizations WHERE id = $1', [organizationId]);
  if (!o || o.owner_id !== actor.id) throw forbidden('Empresa não pertence a esta conta.');
  if (o.approval_status !== 'approved') throw rule('org_not_approved', 'A empresa ainda não foi aprovada pelo suporte.');
}

/** Cria rascunho. Endereço exato fica em tabela privada; a parte pública guarda só bairro/cidade e posição aproximada. */
export async function createRequest(actor: Actor, input: RequestInput): Promise<string> {
  const fe: Record<string, string> = {};
  const cat = await getCategory(input.categoryId);
  if (!cat.enabled) throw rule('category_disabled', 'Esta categoria ainda não está habilitada para contratação.');
  const uf = input.uf.toUpperCase();
  const tz = timezoneForUf(uf);
  if (!tz) fe.uf = 'UF inválida.';
  if (input.kind !== 'urgent' && input.kind !== 'scheduled') fe.kind = 'Tipo inválido.';
  if (input.title.trim().length < 3) fe.title = 'Dê um título ao pedido.';
  if (input.description.trim().length < 10) fe.description = 'Descreva o serviço com mais detalhes.';
  if (!Number.isInteger(input.seats) || input.seats < 1 || input.seats > 50) fe.seats = 'Vagas entre 1 e 50.';
  if (!Number.isSafeInteger(input.priceCents) || input.priceCents < 100) fe.priceCents = 'Informe o valor por profissional.';
  if (!['fixed', 'hour'].includes(input.billingUnit)) fe.billingUnit = 'Modalidade inválida.';
  if (!['digital', 'cash'].includes(input.paymentKind)) fe.paymentKind = 'Forma de pagamento inválida.';
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes < 15 || input.durationMinutes > 20160) fe.durationMinutes = 'Duração estimada inválida.';
  if (input.city.trim().length < 2) fe.city = 'Informe a cidade.';
  if (input.area.trim().length < 2) fe.area = 'Informe o bairro.';
  if (input.street.trim().length < 2) fe.street = 'Informe o endereço.';
  let startsAt: Date | null = null;
  if (input.kind === 'scheduled' && tz) {
    startsAt = zonedToUtc(input.startsAtLocal ?? '', tz);
    if (!startsAt) fe.startsAtLocal = 'Informe data e hora.';
    else if (startsAt <= now()) fe.startsAtLocal = 'A data deve estar no futuro.';
  }
  const lat = input.lat ?? null, lng = input.lng ?? null;
  if ((lat == null) !== (lng == null) || (lat != null && (Math.abs(lat) > 90 || Math.abs(lng!) > 180))) fe.lat = 'Coordenadas inválidas.';
  if (Object.keys(fe).length) throw invalid(Object.values(fe)[0], fe);
  await assertOrganizationUsable(actor, input.organizationId);

  return tx(async () => {
    const r = await q1<{ id: string }>(
      `INSERT INTO service_requests (owner_id, organization_id, category_id, kind, title, description, materials, seats,
         price_cents, billing_unit, payment_kind, starts_at, duration_minutes, timezone, area, city, uf, approx_lat, approx_lng,
         created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$20) RETURNING id`,
      [actor.id, input.organizationId || null, cat.id, input.kind, input.title.trim(), input.description.trim(),
        (input.materials ?? '').trim(), input.seats, input.priceCents, input.billingUnit, input.paymentKind, startsAt,
        input.durationMinutes, tz, input.area.trim(), input.city.trim(), uf,
        // posição pública aproximada (~1 km): duas casas decimais
        lat == null ? null : Math.round(lat * 100) / 100, lng == null ? null : Math.round(lng! * 100) / 100, now()],
    );
    await q('INSERT INTO request_locations (request_id, street, number, complement, reference, lat, lng) VALUES ($1,$2,$3,$4,$5,$6,$7)', [
      r!.id, input.street.trim(), (input.number ?? '').trim(), (input.complement ?? '').trim(), (input.reference ?? '').trim(), lat, lng,
    ]);
    for (const t of [...new Set(input.tagIds ?? [])].filter(isUuid))
      await q('INSERT INTO request_tags (request_id, tag_id) SELECT $1, id FROM tags WHERE id = $2 AND category_id = $3', [r!.id, t, cat.id]);
    return r!.id;
  });
}

async function lockOwned(actor: Actor, id: string): Promise<ServiceRequest> {
  if (!isUuid(id)) throw notFound();
  const r = await q1<ServiceRequest>('SELECT * FROM service_requests WHERE id = $1 FOR UPDATE', [id]);
  if (!r || r.owner_id !== actor.id) throw notFound(); // 404: não revela existência a terceiros
  return r;
}

export async function publishRequest(actor: Actor, id: string) {
  await tx(async () => {
    const r = await lockOwned(actor, id);
    if (r.status !== 'draft') throw conflict('bad_state', 'Este pedido já foi publicado.');
    const cat = await getCategory(r.category_id);
    if (!cat.enabled) throw rule('category_disabled', 'Esta categoria ainda não está habilitada para contratação.');
    await assertOrganizationUsable(actor, r.organization_id);
    const pol = await currentPolicy();
    const t = now();
    let startsAt = r.starts_at, expiresAt: Date;
    if (r.kind === 'urgent') {
      startsAt = t;
      expiresAt = addHours(t, pol.requestExpiryHours);
    } else {
      if (!startsAt || startsAt <= t) throw rule('start_in_past', 'A data do serviço já passou. Crie um novo pedido.');
      expiresAt = startsAt; // agendado recebe propostas até o início
    }
    await q(
      `UPDATE service_requests SET status='open', published_at=$2, starts_at=$3, expires_at=$4, next_wave_at=$2,
              version = version + 1, updated_at=$2 WHERE id=$1`,
      [id, t, startsAt, expiresAt],
    );
    await runWave(id);
  });
}

/** Renova pedido expirado: novo ciclo de divulgação, histórico e contratos preservados. */
export async function renewRequest(actor: Actor, id: string) {
  await tx(async () => {
    const r = await lockOwned(actor, id);
    if (r.status !== 'expired') throw conflict('bad_state', 'Somente pedidos expirados podem ser renovados.');
    const pol = await currentPolicy();
    const t = now();
    let startsAt = r.starts_at!, expiresAt: Date;
    if (r.kind === 'urgent') {
      startsAt = t;
      expiresAt = addHours(t, pol.requestExpiryHours);
    } else {
      if (startsAt <= t) throw rule('start_in_past', 'A data do serviço já passou. Crie um novo pedido.');
      expiresAt = startsAt;
    }
    await q(
      `UPDATE service_requests SET status='open', starts_at=$3, expires_at=$4, cycle=cycle+1, wave=0, next_wave_at=$2,
              version = version + 1, updated_at=$2 WHERE id=$1`,
      [id, t, startsAt, expiresAt],
    );
    // quem já recebeu o chamado é avisado de novo uma única vez por ciclo
    const prev = await q<{ worker_id: string }>('SELECT worker_id FROM request_dispatches WHERE request_id = $1', [id]);
    for (const p of prev)
      await notify(p.worker_id, 'request.renewed', 'Chamado renovado', r.title, `/trabalhar/chamados/${id}`, `dispatch:${id}:${r.cycle + 1}:${p.worker_id}`);
    await runWave(id);
  });
}

export async function adjustRequestPrice(actor: Actor, id: string, priceCents: number) {
  if (!Number.isSafeInteger(priceCents) || priceCents < 100) throw invalid('Valor inválido.');
  await tx(async () => {
    const r = await lockOwned(actor, id);
    if (!['open', 'expired', 'draft'].includes(r.status)) throw conflict('bad_state', 'Este pedido não pode mais ser ajustado.');
    await q('UPDATE service_requests SET price_cents=$2, version=version+1, updated_at=$3 WHERE id=$1', [id, priceCents, now()]);
  });
}

/** Encerra novas vagas (pode fechar com menos pessoas). Contratos existentes seguem inalterados. */
export async function closeRequest(actor: Actor, id: string) {
  await tx(async () => {
    const r = await lockOwned(actor, id);
    if (!['open', 'expired'].includes(r.status)) throw conflict('bad_state', 'Este pedido não está aberto.');
    await q(`UPDATE service_requests SET status='closed', version=version+1, updated_at=$2 WHERE id=$1`, [id, now()]);
    await q(`UPDATE proposals SET status='expired', updated_at=$2 WHERE request_id=$1 AND status IN ('submitted','countered')`, [id, now()]);
  });
}

/** R23: sem profissional contratado, cancelar é gratuito. Com contratos vivos, feche o pedido e trate cada contrato. */
export async function cancelRequest(actor: Actor, id: string) {
  await tx(async () => {
    const r = await lockOwned(actor, id);
    if (!['draft', 'open', 'expired'].includes(r.status)) throw conflict('bad_state', 'Este pedido não pode ser cancelado.');
    const live = await q1<{ c: number }>(`SELECT count(*)::int AS c FROM contracts WHERE request_id=$1 AND status <> 'cancelled'`, [id]);
    if (live!.c > 0)
      throw rule('has_contracts', 'Há profissionais contratados. Encerre as vagas restantes e cancele cada contrato individualmente.');
    await q(`UPDATE service_requests SET status='cancelled', version=version+1, updated_at=$2 WHERE id=$1`, [id, now()]);
    await q(`UPDATE proposals SET status='expired', updated_at=$2 WHERE request_id=$1 AND status IN ('submitted','countered')`, [id, now()]);
  });
}

/** Job: expiração encerra novas propostas, nunca cancela contratos já confirmados. */
export async function expireDueRequests(): Promise<number> {
  const rows = await q<{ id: string; owner_id: string; title: string; cycle: number }>(
    `UPDATE service_requests SET status='expired', version=version+1, updated_at=$1
      WHERE status='open' AND expires_at <= $1 RETURNING id, owner_id, title, cycle`,
    [now()],
  );
  for (const r of rows)
    await notify(r.owner_id, 'request.expired', 'Seu pedido expirou', `${r.title}: renove, ajuste o valor ou cancele.`,
      `/contratar/pedidos/${r.id}`, `request.expired:${r.id}:${r.cycle}`);
  return rows.length;
}

// ───────────── Visibilidade ─────────────

export type RequestView = {
  request: ServiceRequest;
  role: 'owner' | 'contracted_worker' | 'candidate';
  /** Endereço exato: somente dono e trabalhador com contrato confirmado (R12). */
  location: RequestLocation | null;
  tags: string[];
};

export async function getRequestForViewer(actor: Actor, id: string): Promise<RequestView> {
  if (!isUuid(id)) throw notFound();
  const r = await q1<ServiceRequest>(`SELECT ${REQ_SELECT} FROM service_requests r JOIN categories c ON c.id = r.category_id WHERE r.id = $1`, [id]);
  if (!r) throw notFound();
  let role: RequestView['role'];
  if (r.owner_id === actor.id) role = 'owner';
  else {
    const confirmed = await q1(
      `SELECT 1 FROM contracts WHERE request_id=$1 AND worker_id=$2
          AND status IN ('confirmed','en_route','in_progress','completion_requested','completed')`,
      [id, actor.id],
    );
    if (confirmed) role = 'contracted_worker';
    else {
      const related = await q1(
        `SELECT 1 FROM request_dispatches WHERE request_id=$1 AND worker_id=$2
         UNION ALL SELECT 1 FROM proposals WHERE request_id=$1 AND worker_id=$2 LIMIT 1`,
        [id, actor.id],
      );
      if (!related) throw notFound();
      role = 'candidate';
    }
  }
  const location = role === 'candidate'
    ? null
    : (await q1<RequestLocation>('SELECT street, number, complement, reference FROM request_locations WHERE request_id=$1', [id])) ?? null;
  const tags = (await q<{ name: string }>('SELECT t.name FROM request_tags rt JOIN tags t ON t.id = rt.tag_id WHERE rt.request_id=$1 ORDER BY t.name', [id])).map((t) => t.name);
  return { request: r, role, location, tags };
}

export async function listMyRequests(actor: Actor): Promise<(ServiceRequest & { live_proposals: number })[]> {
  return q(
    `SELECT ${REQ_SELECT},
       (SELECT count(*)::int FROM proposals p WHERE p.request_id = r.id AND p.status IN ('submitted','countered')) AS live_proposals
       FROM service_requests r JOIN categories c ON c.id = r.category_id
      WHERE r.owner_id = $1 ORDER BY r.created_at DESC LIMIT 100`,
    [actor.id],
  );
}

/** Chamados distribuídos a este trabalhador, ainda abertos e com vaga. Nunca inclui endereço exato. */
export async function listFeedForWorker(actor: Actor): Promise<(ServiceRequest & { my_proposal_status: string | null })[]> {
  return q(
    `SELECT ${REQ_SELECT},
        (SELECT p.status FROM proposals p WHERE p.request_id = r.id AND p.worker_id = $1 ORDER BY p.created_at DESC LIMIT 1) AS my_proposal_status
       FROM request_dispatches d
       JOIN service_requests r ON r.id = d.request_id
       JOIN categories c ON c.id = r.category_id
      WHERE d.worker_id = $1 AND r.status = 'open' AND r.expires_at > $2 AND r.owner_id <> $1
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = $1 AND b.blocked_id = r.owner_id) OR (b.blocker_id = r.owner_id AND b.blocked_id = $1))
        AND NOT EXISTS (SELECT 1 FROM contracts k WHERE k.request_id = r.id AND k.worker_id = $1 AND k.status <> 'cancelled')
        AND (SELECT count(*) FROM contracts k WHERE k.request_id = r.id AND k.status <> 'cancelled') < r.seats
      ORDER BY (r.kind = 'urgent') DESC, r.published_at DESC LIMIT 100`,
    [actor.id, now()],
  );
}

// ───────────── Matching em grupos progressivos (R07; parâmetros P04) ─────────────

/**
 * Despacha o próximo grupo de trabalhadores elegíveis. Filtro rígido: categoria, validação de identidade/telefone,
 * bloqueio, disponibilidade (urgente exige "online"), agenda e raio. Ordena por distância, compatibilidade de tags
 * e reputação; profissional novo sem nota NÃO é excluído. Premium não participa do algoritmo.
 */
export async function runWave(requestId: string): Promise<number> {
  return tx(async () => {
    const r = await q1<ServiceRequest>('SELECT * FROM service_requests WHERE id = $1 FOR UPDATE', [requestId]);
    if (!r || r.status !== 'open') return 0;
    const pol = await currentPolicy();
    const cat = await getCategory(r.category_id);
    const t = now();
    const wave = r.wave + 1;
    const waveRadius = Math.min(pol.matchingInitialRadiusKm * wave, cat.max_radius_km);
    const winStart = r.kind === 'urgent' ? t : r.starts_at!;
    const winEnd = addMinutes(winStart, r.duration_minutes);
    const exact = await q1<{ lat: number | null; lng: number | null }>('SELECT lat, lng FROM request_locations WHERE request_id=$1', [requestId]);

    const candidates = await q<{
      id: string; radius_km: number; lat: number | null; lng: number | null; city: string; uf: string;
      tag_matches: number; rating_sum: number | null; rating_count: number;
    }>(
      `SELECT u.id, p.radius_km, p.lat, p.lng, p.city, p.uf,
              (SELECT count(*)::int FROM worker_tags wt JOIN request_tags rt ON rt.tag_id = wt.tag_id
                WHERE wt.user_id = u.id AND rt.request_id = $1) AS tag_matches,
              (SELECT sum(rating)::int FROM reviews v WHERE v.target_id = u.id AND v.target_role='worker' AND v.published_at IS NOT NULL) AS rating_sum,
              (SELECT count(*)::int FROM reviews v WHERE v.target_id = u.id AND v.target_role='worker' AND v.published_at IS NOT NULL) AS rating_count
         FROM worker_profiles p
         JOIN users u ON u.id = p.user_id
         JOIN worker_skills s ON s.user_id = u.id AND s.category_id = $2
        WHERE u.status = 'active' AND u.phone_verified_at IS NOT NULL AND u.identity_status = 'verified'
          AND u.id <> $3
          AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = u.id AND b.blocked_id = $3) OR (b.blocker_id = $3 AND b.blocked_id = u.id))
          AND NOT EXISTS (SELECT 1 FROM request_dispatches d WHERE d.request_id = $1 AND d.worker_id = u.id)
          AND ($4 = 'scheduled' OR p.online_until > $5)
          AND NOT EXISTS (SELECT 1 FROM availability_blocks a WHERE a.worker_id = u.id AND a.during && tstzrange($6,$7,'[)'))
          AND NOT EXISTS (SELECT 1 FROM schedule_reservations sr WHERE sr.worker_id = u.id AND sr.state = 'confirmed' AND sr.during && tstzrange($6,$7,'[)'))`,
      [requestId, r.category_id, r.owner_id, r.kind, t, winStart, winEnd],
    );

    const scored = candidates
      .map((c) => {
        // Sem coordenadas de um dos lados, cai para a mesma cidade/UF (consentimento de localização é opcional, R04).
        if (exact?.lat != null && exact.lng != null && c.lat != null && c.lng != null) {
          const d = distanceKm(exact.lat, exact.lng, c.lat, c.lng);
          return d <= Math.min(waveRadius, c.radius_km) ? { c, d } : null;
        }
        const sameCity = c.uf === r.uf && c.city.trim().toLowerCase() === r.city.trim().toLowerCase();
        return sameCity ? { c, d: Number.MAX_SAFE_INTEGER } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) =>
        a.d - b.d || b.c.tag_matches - a.c.tag_matches ||
        // nota média; sem avaliações conta como neutra (3), para não eliminar nem privilegiar novatos
        (b.c.rating_count ? b.c.rating_sum! / b.c.rating_count : 3) - (a.c.rating_count ? a.c.rating_sum! / a.c.rating_count : 3))
      .slice(0, pol.matchingBatchSize);

    for (const { c } of scored) {
      await q('INSERT INTO request_dispatches (request_id, worker_id, wave, cycle, created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [
        requestId, c.id, wave, r.cycle, t,
      ]);
      await notify(c.id, 'request.dispatched', r.kind === 'urgent' ? 'Novo chamado urgente' : 'Novo chamado agendado',
        `${r.title} — ${r.area}, ${r.city}`, `/trabalhar/chamados/${requestId}`, `dispatch:${requestId}:${r.cycle}:${c.id}`);
    }
    await q('UPDATE service_requests SET wave=$2, next_wave_at=$3 WHERE id=$1', [
      requestId, wave, new Date(t.getTime() + pol.matchingBatchIntervalSeconds * 1000),
    ]);
    return scored.length;
  });
}

/** Job: avança os grupos dos pedidos abertos cujo intervalo venceu. */
export async function advanceMatching(): Promise<number> {
  const due = await q<{ id: string }>(
    `SELECT id FROM service_requests WHERE status='open' AND next_wave_at <= $1 AND expires_at > $1 ORDER BY next_wave_at LIMIT 50`,
    [now()],
  );
  let n = 0;
  for (const r of due) n += await runWave(r.id);
  return n;
}

/** Verificações comuns para qualquer interação nova entre trabalhador e pedido. */
export async function assertCanEngage(workerId: string, r: Pick<ServiceRequest, 'id' | 'owner_id' | 'category_id'>) {
  if (r.owner_id === workerId) throw rule('self_hire', 'Você não pode se candidatar ao próprio pedido.');
  const cat = await getCategory(r.category_id);
  if (!cat.enabled) throw rule('category_disabled', 'Esta categoria ainda não está habilitada para contratação.');
  if (await isBlockedBetween(workerId, r.owner_id)) throw forbidden('Não é possível interagir com este usuário.');
}

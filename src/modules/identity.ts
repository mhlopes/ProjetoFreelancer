import crypto from 'node:crypto';
import { q, q1, tx } from '@/lib/db';
import { now, addMinutes } from '@/lib/clock';
import { config } from '@/lib/config';
import {
  blindIndex, encrypt, hashPassword, normalizeCnpj, normalizeCpf, randomToken, safeEqual, sha256, verifyPassword,
} from '@/lib/crypto';
import { AppError, conflict, forbidden, invalid, notFound, rule } from '@/lib/errors';
import { audit, rateLimit, type Actor } from './core';

export type User = {
  id: string; name: string; email: string; phone: string; status: 'active' | 'blocked'; is_support: boolean;
  phone_verified_at: Date | null; identity_status: 'unverified' | 'verified' | 'failed'; active_mode: 'client' | 'worker';
};
const USER_COLS = 'id, name, email, phone, status, is_support, phone_verified_at, identity_status, active_mode';

const SESSION_DAYS = 14;

function ageOn(birth: Date, at: Date): number {
  let age = at.getUTCFullYear() - birth.getUTCFullYear();
  const m = at.getUTCMonth() - birth.getUTCMonth();
  if (m < 0 || (m === 0 && at.getUTCDate() < birth.getUTCDate())) age--;
  return age;
}

export async function register(input: {
  name: string; email: string; phone: string; cpf: string; birthDate: string; password: string;
}): Promise<User> {
  const fe: Record<string, string> = {};
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const phone = input.phone.replace(/\D/g, '');
  const cpf = normalizeCpf(input.cpf);
  const birth = /^\d{4}-\d{2}-\d{2}$/.test(input.birthDate) ? new Date(`${input.birthDate}T00:00:00Z`) : null;
  if (name.length < 2) fe.name = 'Informe seu nome completo.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fe.email = 'E-mail inválido.';
  if (phone.length < 10 || phone.length > 13) fe.phone = 'Telefone inválido (com DDD).';
  if (!cpf) fe.cpf = 'CPF inválido.';
  if (!birth || Number.isNaN(birth.getTime())) fe.birthDate = 'Data de nascimento inválida.';
  else if (ageOn(birth, now()) < 18) fe.birthDate = 'O cadastro é permitido somente para maiores de 18 anos.';
  if (input.password.length < 8) fe.password = 'A senha deve ter ao menos 8 caracteres.';
  if (Object.keys(fe).length) throw invalid(Object.values(fe)[0], fe);

  const exists = await q1('SELECT 1 FROM users WHERE email = $1 OR cpf_index = $2', [email, blindIndex(cpf!)]);
  if (exists) throw conflict('account_exists', 'Já existe uma conta com este e-mail ou CPF.');
  const u = await q1<User>(
    `INSERT INTO users (name, email, phone, birth_date, cpf_enc, cpf_index, password_hash, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING ${USER_COLS}`,
    [name, email, phone, input.birthDate, encrypt(cpf!), blindIndex(cpf!), hashPassword(input.password), now()],
  );
  return u!;
}

export async function login(emailRaw: string, password: string): Promise<{ token: string; user: User }> {
  const email = emailRaw.trim().toLowerCase();
  await rateLimit('login', email, 8, 15 * 60);
  const row = await q1<User & { password_hash: string }>(`SELECT ${USER_COLS}, password_hash FROM users WHERE email = $1`, [email]);
  // Mesma mensagem para e-mail inexistente e senha errada (evita enumeração).
  if (!row || !verifyPassword(password, row.password_hash)) throw new AppError(401, 'bad_credentials', 'E-mail ou senha incorretos.');
  if (row.status === 'blocked') throw forbidden('Conta bloqueada. Fale com o suporte.');
  const token = randomToken();
  await q('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES ($1,$2,$3,$4)', [
    sha256(token), row.id, addMinutes(now(), SESSION_DAYS * 24 * 60), now(),
  ]);
  const { password_hash: _ph, ...user } = row;
  return { token, user };
}

export async function userFromSessionToken(token: string | undefined): Promise<User | null> {
  if (!token) return null;
  const u = await q1<User>(
    `SELECT ${USER_COLS.split(', ').map((c) => `u.${c}`).join(', ')}
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > $2 AND u.status = 'active'`,
    [sha256(token), now()],
  );
  return u ?? null;
}

export async function logout(token: string | undefined) {
  if (token) await q('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
}

export async function getUser(id: string): Promise<User> {
  const u = await q1<User>(`SELECT ${USER_COLS} FROM users WHERE id = $1`, [id]);
  if (!u) throw notFound();
  return u;
}

export const toActor = (u: User): Actor => ({ id: u.id, isSupport: u.is_support });

export async function setMode(actor: Actor, mode: string) {
  if (mode !== 'client' && mode !== 'worker') throw invalid('Modo inválido.');
  await q('UPDATE users SET active_mode = $2, updated_at = $3 WHERE id = $1', [actor.id, mode, now()]);
}

/** R02: receber/aceitar chamados depende de telefone e identidade validados. */
export function isWorkerEligible(u: Pick<User, 'status' | 'phone_verified_at' | 'identity_status'>): boolean {
  return u.status === 'active' && !!u.phone_verified_at && u.identity_status === 'verified';
}

export async function requireEligibleWorker(userId: string): Promise<User> {
  const u = await getUser(userId);
  if (!isWorkerEligible(u))
    throw rule('worker_not_verified', 'Valide seu telefone e sua identidade para receber e aceitar chamados.');
  return u;
}

// ───────────── Verificação de telefone (adaptador SIMULADO) ─────────────

/** Gera código de 6 dígitos. Com provedor mock o código é devolvido para exibição na tela (não há SMS real). */
export async function requestPhoneOtp(actor: Actor): Promise<{ mockCode: string | null }> {
  await rateLimit('otp_request', actor.id, 5, 15 * 60);
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await q('UPDATE phone_otps SET consumed_at = $2 WHERE user_id = $1 AND consumed_at IS NULL', [actor.id, now()]);
  await q('INSERT INTO phone_otps (user_id, code_hash, expires_at, created_at) VALUES ($1,$2,$3,$4)', [
    actor.id, sha256(`${actor.id}:${code}`), addMinutes(now(), 10), now(),
  ]);
  if (config.identityProvider !== 'mock') throw new Error('Provedor de OTP real não configurado (O08)');
  return { mockCode: code };
}

export async function verifyPhoneOtp(actor: Actor, code: string) {
  // Tentativa é contada fora da transação para sobreviver a erro.
  const otp = await q1<{ id: string; code_hash: string; attempts: number }>(
    `UPDATE phone_otps SET attempts = attempts + 1
      WHERE id = (SELECT id FROM phone_otps WHERE user_id = $1 AND consumed_at IS NULL AND expires_at > $2
                  ORDER BY created_at DESC LIMIT 1)
      RETURNING id, code_hash, attempts`,
    [actor.id, now()],
  );
  if (!otp) throw rule('otp_missing', 'Código expirado. Solicite um novo código.');
  if (otp.attempts > 5) throw rule('otp_attempts', 'Muitas tentativas. Solicite um novo código.');
  if (!safeEqual(otp.code_hash, sha256(`${actor.id}:${code.trim()}`))) throw rule('otp_wrong', 'Código incorreto.');
  await tx(async () => {
    await q('UPDATE phone_otps SET consumed_at = $2 WHERE id = $1', [otp.id, now()]);
    await q('UPDATE users SET phone_verified_at = $2, updated_at = $2 WHERE id = $1', [actor.id, now()]);
  });
}

// ───────────── Verificação de identidade (adaptador SIMULADO) ─────────────

/**
 * Inicia validação de identidade via adaptador. O mock decide pelo cenário informado (apenas fora de produção);
 * guarda somente a referência do provedor, nunca o documento.
 */
export async function startIdentityVerification(actor: Actor, scenario: 'approve' | 'fail' = 'approve') {
  if (config.identityProvider !== 'mock') throw new Error('Provedor de identidade real não configurado (O02)');
  const status = scenario === 'fail' ? 'failed' : 'verified';
  await tx(async () => {
    await q(
      'INSERT INTO identity_verifications (user_id, provider, provider_ref, status, checked_at) VALUES ($1,$2,$3,$4,$5)',
      [actor.id, 'mock', `mock_idv_${randomToken(8)}`, status, now()],
    );
    await q('UPDATE users SET identity_status = $2, updated_at = $3 WHERE id = $1', [actor.id, status, now()]);
  });
  return status;
}

// ───────────── Empresas ─────────────

export type Organization = {
  id: string; owner_id: string; name: string; approval_status: 'pending_review' | 'approved' | 'rejected';
  review_reason: string | null; created_at: Date;
};

export async function createOrganization(actor: Actor, input: { name: string; cnpj: string }): Promise<Organization> {
  const cnpj = normalizeCnpj(input.cnpj);
  if (!cnpj) throw invalid('CNPJ inválido.', { cnpj: 'CNPJ inválido.' });
  if (input.name.trim().length < 2) throw invalid('Informe o nome da empresa.');
  if (await q1('SELECT 1 FROM organizations WHERE cnpj_index = $1', [blindIndex(cnpj)]))
    throw conflict('org_exists', 'Já existe uma empresa cadastrada com este CNPJ.');
  const o = await q1<Organization>(
    `INSERT INTO organizations (owner_id, name, cnpj_enc, cnpj_index, created_at) VALUES ($1,$2,$3,$4,$5)
     RETURNING id, owner_id, name, approval_status, review_reason, created_at`,
    [actor.id, input.name.trim(), encrypt(cnpj), blindIndex(cnpj), now()],
  );
  return o!;
}

export async function listMyOrganizations(actor: Actor): Promise<Organization[]> {
  return q<Organization>(
    'SELECT id, owner_id, name, approval_status, review_reason, created_at FROM organizations WHERE owner_id = $1 ORDER BY created_at',
    [actor.id],
  );
}

export async function reviewOrganization(actor: Actor, orgId: string, decision: 'approved' | 'rejected', reason: string) {
  if (!actor.isSupport) throw forbidden();
  if (reason.trim().length < 5) throw invalid('Informe o motivo da decisão.');
  await tx(async () => {
    const o = await q1('SELECT id FROM organizations WHERE id = $1 FOR UPDATE', [orgId]);
    if (!o) throw notFound();
    await q('UPDATE organizations SET approval_status = $2, review_reason = $3, reviewed_by = $4, reviewed_at = $5 WHERE id = $1', [
      orgId, decision, reason.trim(), actor.id, now(),
    ]);
    await audit(actor.id, `organization.${decision}`, 'organization', orgId, reason.trim());
  });
}

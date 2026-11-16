import crypto from 'node:crypto';
import { config } from './config';

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
export const hmac = (s: string, secret = config.authSecret) => crypto.createHmac('sha256', secret).update(s).digest('hex');

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const SCRYPT = { N: 16384, r: 8, p: 1 };

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [alg, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const h = crypto.scryptSync(password, Buffer.from(salt, 'base64'), 64, SCRYPT);
  const expected = Buffer.from(hash, 'base64');
  return h.length === expected.length && crypto.timingSafeEqual(h, expected);
}

const encKey = () => crypto.createHash('sha256').update(`enc:${config.authSecret}`).digest();

/** Cifra dado sensível (CPF/CNPJ) com AES-256-GCM. */
export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

export function decrypt(enc: string): string {
  const [iv, tag, data] = enc.split('.').map((s) => Buffer.from(s, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', encKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString('utf8');
}

/** Índice cego para unicidade sem guardar o documento em claro. */
export const blindIndex = (normalized: string) => hmac(`idx:${normalized}`);

const digits = (s: string) => s.replace(/\D/g, '');

export function cpfCheckDigits(base9: string): string {
  const dv = (d: string) => {
    let sum = 0;
    for (let i = 0; i < d.length; i++) sum += Number(d[i]) * (d.length + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(base9);
  return `${d1}${dv(base9 + d1)}`;
}

export function normalizeCpf(input: string): string | null {
  const d = digits(input);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return null;
  return cpfCheckDigits(d.slice(0, 9)) === d.slice(9) ? d : null;
}

export function cnpjCheckDigits(base12: string): string {
  const dv = (d: string) => {
    const w = d.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const r = w.reduce((acc, wi, i) => acc + Number(d[i]) * wi, 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(base12);
  return `${d1}${dv(base12 + d1)}`;
}

export function normalizeCnpj(input: string): string | null {
  const d = digits(input);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return null;
  return cnpjCheckDigits(d.slice(0, 12)) === d.slice(12) ? d : null;
}

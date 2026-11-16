import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { config } from './config';
import { toActor, userFromSessionToken, type User } from '@/modules/identity';
import type { Actor } from '@/modules/core';

export const SESSION_COOKIE = 'sid';

/** Usuário da sessão (cookie httpOnly). Uma leitura por requisição. */
export const currentUser = cache(async (): Promise<User | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return userFromSessionToken(token);
});

export async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u) redirect('/entrar');
  return u;
}

export async function requireActor(): Promise<{ user: User; actor: Actor }> {
  const user = await requireUser();
  return { user, actor: toActor(user) };
}

export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: config.env === 'production', path: '/', maxAge: 14 * 24 * 3600,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function sessionToken() {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

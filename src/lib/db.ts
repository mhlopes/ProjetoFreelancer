import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mapDbError } from './errors';

/**
 * Persistência: PostgreSQL. Em desenvolvimento/teste roda embarcado (PGlite), sem instalar servidor.
 * O SQL é PostgreSQL padrão; usar um servidor real exige apenas outro driver com a mesma interface (q/tx).
 * O PGlite serializa transações (conexão única); os locks FOR UPDATE continuam escritos para o servidor real.
 */
type Handle = { query: (sql: string, params?: any[]) => Promise<{ rows: unknown[] }> };

const als = new AsyncLocalStorage<Handle>();
const g = globalThis as unknown as { __appDb?: Promise<PGlite> };

/**
 * Banco local FORA da pasta do projeto: o `next dev` vigia o projeto inteiro, e cada gravação do banco
 * dispararia recompilação e recarga da página em ciclo.
 */
export function defaultDataDir(): string {
  return path.join(os.homedir(), '.plataforma-servicos', 'pgdata');
}

async function open(): Promise<PGlite> {
  const dir = process.env.PGLITE_DIR || defaultDataDir();
  let db: PGlite;
  if (dir === 'memory') db = new PGlite({ extensions: { btree_gist } });
  else {
    fs.mkdirSync(path.dirname(path.resolve(/*turbopackIgnore: true*/ dir)), { recursive: true });
    db = new PGlite(path.resolve(/*turbopackIgnore: true*/ dir), { extensions: { btree_gist } });
  }
  await db.waitReady;
  await migrate(db);
  return db;
}

export async function migrate(db: PGlite) {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
  );
  const dir = path.join(/*turbopackIgnore: true*/ process.cwd(), "db", "migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const done = new Set(
    (await db.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
  );
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    await db.transaction(async (t) => {
      await t.exec(sql);
      await t.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
    });
  }
}

export function root(): Promise<PGlite> {
  if (!g.__appDb) g.__appDb = open();
  return g.__appDb;
}

/** Fecha e descarta a instância (testes e scripts). */
export async function closeDb() {
  if (g.__appDb) {
    const db = await g.__appDb;
    g.__appDb = undefined;
    await db.close();
  }
}

export async function q<T = Record<string, any>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const h: Handle = als.getStore() ?? ((await root()) as unknown as Handle);
  try {
    return (await h.query(sql, params as any[])).rows as T[];
  } catch (e) {
    throw mapDbError(e);
  }
}

export async function q1<T = Record<string, any>>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await q<T>(sql, params))[0];
}

/** Transação. Chamadas aninhadas participam da transação externa. Qualquer erro desfaz tudo. */
export async function tx<T>(fn: () => Promise<T>): Promise<T> {
  if (als.getStore()) return fn();
  const db = await root();
  try {
    return (await db.transaction((t) => als.run(t as unknown as Handle, fn))) as T;
  } catch (e) {
    throw mapDbError(e);
  }
}

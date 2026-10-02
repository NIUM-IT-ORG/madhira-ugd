import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/**
 * One query interface over two engines:
 *  - PostgreSQL (any host or managed service) when DATABASE_URL is set — production;
 *  - PGlite (Postgres compiled to WebAssembly, stored in a folder) otherwise — local runs and small installs.
 * Both expose query(sql, params) -> { rows } and tx(fn) for transactions.
 */
export async function openDb() {
  let db;
  if (config.databaseUrl) {
    const pg = (await import('pg')).default;
    pg.types.setTypeParser(20, (v) => Number(v)); // bigint ids / counts -> number
    const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
    // A dropped idle connection must not crash the server; the pool reconnects on the next query.
    pool.on('error', (e) => console.error('database connection error:', e.message));
    db = {
      engine: 'postgres',
      query: (sql, params) => pool.query(sql, params),
      async tx(fn) {
        const c = await pool.connect();
        try {
          await c.query('begin');
          const out = await fn({ query: (sql, params) => c.query(sql, params) });
          await c.query('commit');
          return out;
        } catch (e) {
          await c.query('rollback');
          throw e;
        } finally {
          c.release();
        }
      },
      close: () => pool.end(),
    };
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    fs.mkdirSync(config.pgliteDir, { recursive: true });
    const lite = new PGlite(config.pgliteDir);
    await lite.waitReady;
    db = {
      engine: 'pglite',
      query: (sql, params) => lite.query(sql, params),
      tx: (fn) => lite.transaction((t) => fn({ query: (sql, params) => t.query(sql, params) })),
      close: () => lite.close(),
    };
  }
  await migrate(db);
  return db;
}

async function migrate(db) {
  await db.query('create table if not exists schema_migrations (id text primary key, applied_at timestamptz not null default now())');
  const done = new Set((await db.query('select id from schema_migrations')).rows.map((r) => r.id));
  for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    await db.tx(async (t) => {
      for (const stmt of sql.split(/;\s*$/m).map((s) => s.trim()).filter(Boolean)) await t.query(stmt);
      await t.query('insert into schema_migrations (id) values ($1)', [file]);
    });
  }
}

/** Next number in a named sequence, e.g. stretch codes per ward. */
export async function nextCounter(q, name) {
  const r = await q.query(
    `insert into counters (name, value) values ($1, 1)
     on conflict (name) do update set value = counters.value + 1 returning value`,
    [name],
  );
  return r.rows[0].value;
}

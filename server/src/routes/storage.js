import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import yazl from 'yazl';
import { z } from 'zod';
import { config } from '../config.js';
import { publish } from '../events.js';

/**
 * Storage page (Commissioner only): how much space the data uses, and deleting old data to stay within the
 * cloud plan. Everything can be deleted; each clean-up is recorded in storage_purges. A dry run (the same
 * deletes inside a transaction that is rolled back) gives the exact preview and the rows for the archive.
 */

export const CATEGORIES = [
  { key: 'photos', label: 'Photos', hint: 'Photos uploaded before the date, from stretches and issues. Usually most of the space.' },
  { key: 'history', label: 'Stretch history', hint: 'Older history entries of each stretch, including approvals and rejections. The current status of every stretch, and its status on the chosen date, are kept.' },
  { key: 'resolved_issues', label: 'Resolved issues', hint: 'Issues resolved before the date, with their history.' },
  { key: 'requests', label: 'Decided change requests', hint: 'Approved, rejected and withdrawn requests. Approved changes stay on the map.' },
  { key: 'removed_stretches', label: 'Deleted and rejected stretches', hint: 'Stretches deleted or rejected before the date, with their history and resolved issues. Open issues on them are kept.' },
  { key: 'labour', label: 'Labour entries', hint: 'Daily labour and machine figures before the date.' },
  { key: 'audit', label: 'Sign-in and admin log', hint: 'Sign-ins, password changes and user changes.' },
  { key: 'cleanup_log', label: 'Clean-up log', hint: 'Earlier entries of this page\'s own log. A new entry is always written for this clean-up.' },
];
const KEYS = CATEGORIES.map((c) => c.key);

const body = z.object({
  categories: z.array(z.enum(KEYS)).min(1, 'Choose what to delete.'),
  before: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date.'),
  confirm: z.string().optional(),
});

// Dates are days in India time: "before 2026-04-01" = before midnight at the start of 1 April, IST.
const TZ_OFFSET = process.env.TIME_ZONE_OFFSET ?? '+05:30';
const cutoffOf = (before) => new Date(`${before}T00:00:00${TZ_OFFSET}`);

class Rollback extends Error {}

const sumBytes = (rows) => rows.reduce((a, r) => a + Number(r.bytes ?? 0), 0);
const ids = (rows) => rows.map((r) => r.id);

/** Delete the chosen categories; returns what was deleted (rows and photo files). Runs inside a transaction. */
async function runPurge(q, cats, before) {
  const cutoff = cutoffOf(before);
  const has = (k) => cats.includes(k);
  const rows = {};
  const summary = {};
  const files = [];
  const photoRows = async (key, photos) => {
    rows[key] = (rows[key] ?? []).concat(photos);
    summary[key] = { rows: (summary[key]?.rows ?? 0) + photos.length, bytes: (summary[key]?.bytes ?? 0) + sumBytes(photos) };
    for (const p of photos) files.push({ path: p.path, bytes: Number(p.bytes) });
  };

  if (has('removed_stretches')) {
    const s = (await q.query(
      `select id from stretches where (deleted_at is not null and deleted_at < $1) or (record_state = 'rejected' and updated_at < $1)`, [cutoff],
    )).rows.map((r) => r.id);
    // Issues still open (e.g. reported by hand on the road) are kept: only their link to the road goes.
    const kept = (await q.query(
      `update issues set stretch_id = null where stretch_id = any($1::uuid[]) and status <> 'resolved' returning id`, [s],
    )).rows.length;
    const ev = (await q.query('delete from issue_events where issue_id in (select id from issues where stretch_id = any($1::uuid[])) returning *', [s])).rows;
    const is = (await q.query('delete from issues where stretch_id = any($1::uuid[]) returning *', [s])).rows;
    const vs = (await q.query('delete from stretch_versions where stretch_id = any($1::uuid[]) returning *', [s])).rows;
    const st = (await q.query('delete from stretches where id = any($1::uuid[]) returning *', [s])).rows;
    rows.removed_stretches = st;
    rows['removed_stretches.history'] = vs;
    rows['removed_stretches.issues'] = is;
    rows['removed_stretches.issue_history'] = ev;
    summary.removed_stretches = {
      rows: st.length, bytes: 0,
      detail: `${vs.length} history entries, ${is.length} resolved issues${kept ? `; ${kept} open issue${kept > 1 ? 's' : ''} kept` : ''}`,
    };
  }
  if (has('resolved_issues')) {
    const i = (await q.query(`select id from issues where status = 'resolved' and resolved_at < $1`, [cutoff])).rows.map((r) => r.id);
    const ev = (await q.query('delete from issue_events where issue_id = any($1::uuid[]) returning *', [i])).rows;
    const is = (await q.query('delete from issues where id = any($1::uuid[]) returning *', [i])).rows;
    rows.resolved_issues = is;
    rows['resolved_issues.history'] = ev;
    summary.resolved_issues = { rows: is.length, bytes: 0, detail: `${ev.length} history entries` };
  }
  if (has('history')) {
    // Kept for each stretch: its latest version (current status) and the last version before the date, which is
    // the full status snapshot the dashboard's weekly chart starts from. Everything older goes.
    const vs = (await q.query(
      `delete from stretch_versions v using stretches s
       where s.id = v.stretch_id and v.at < $1 and v.version < s.version
         and v.version < (select max(b.version) from stretch_versions b where b.stretch_id = v.stretch_id and b.at < $1)
       returning v.*`, [cutoff],
    )).rows;
    rows.history = vs;
    summary.history = { rows: vs.length, bytes: 0 };
  }
  if (has('requests')) {
    const c = (await q.query(
      `select id from change_requests where status <> 'pending' and coalesce(decided_at, requested_at) < $1`, [cutoff],
    )).rows.map((r) => r.id);
    await q.query('update network_edits set change_request_id = null where change_request_id = any($1::uuid[])', [c]);
    const cr = (await q.query('delete from change_requests where id = any($1::uuid[]) returning *', [c])).rows;
    rows.requests = cr;
    summary.requests = { rows: cr.length, bytes: 0 };
  }
  if (has('labour')) {
    const l = (await q.query('delete from labour_logs where log_date < $1::date returning *', [before])).rows;
    rows.labour = l;
    summary.labour = { rows: l.length, bytes: 0 };
  }
  if (has('audit')) {
    const a = (await q.query('delete from audit_log where at < $1 returning *', [cutoff])).rows;
    rows.audit = a;
    summary.audit = { rows: a.length, bytes: 0 };
  }
  if (has('cleanup_log')) {
    const p = (await q.query('delete from storage_purges where at < $1 returning *', [cutoff])).rows;
    rows.cleanup_log = p;
    summary.cleanup_log = { rows: p.length, bytes: 0 };
  }
  if (has('photos')) {
    const ph = (await q.query('select * from photos where uploaded_at < $1', [cutoff])).rows;
    const list = ids(ph).map(String);
    await q.query('update stretch_versions set photos = array(select x from unnest(photos) x where not (x = any($1::text[]))) where photos && $1::text[]', [list]);
    await q.query('update issues set photos = array(select x from unnest(photos) x where not (x = any($1::text[]))) where photos && $1::text[]', [list]);
    await q.query('delete from photos where id = any($1::uuid[])', [list]);
    await photoRows('photos', ph);
  }
  // Photos that nothing refers to any more (their history entries or issues were deleted above). Photos from the
  // last day are left alone: a phone may have uploaded them and not yet sent the update that uses them.
  const keepAfter = new Date(Math.min(cutoff.getTime(), Date.now() - 86400000));
  const orphans = (await q.query(
    `delete from photos p where p.uploaded_at < $1
       and not exists (select 1 from stretch_versions v where p.id::text = any(v.photos))
       and not exists (select 1 from issues i where p.id::text = any(i.photos))
     returning *`, [keepAfter],
  )).rows;
  if (orphans.length) await photoRows('unused_photos', orphans);
  return { summary, rows, files };
}

/** Same deletes, rolled back: the exact preview, and the rows for the archive. */
async function dryRun(db, cats, before) {
  let out;
  try {
    await db.tx(async (q) => {
      out = await runPurge(q, cats, before);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  return out;
}

function dirBytes(dir) {
  let n = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    n += e.isDirectory() ? dirBytes(p) : fs.statSync(p).size;
  }
  return n;
}

const cell = (v) => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 32000); // Excel's cell limit is 32,767 characters
  return typeof v === 'string' ? v.slice(0, 32000) : v;
};

async function archiveWorkbook(rows, before) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Madhira UGD Tracker';
  const about = wb.addWorksheet('About');
  about.addRows([
    ['Madhira UGD Tracker: data archived before deletion'],
    ['Deleted: everything before', before],
    ['Made on', new Date()],
    [],
    ['Sheet', 'Rows'],
    ...Object.entries(rows).map(([k, r]) => [k, r.length]),
  ]);
  about.getColumn(1).width = 34;
  about.getColumn(2).width = 24;
  for (const [k, list] of Object.entries(rows)) {
    if (!list.length) continue;
    const ws = wb.addWorksheet(k.replace(/[^a-z_.]/gi, '').slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
    const cols = Object.keys(list[0]);
    ws.columns = cols.map((c) => ({ header: c, width: Math.min(40, Math.max(10, c.length + 2)) }));
    ws.getRow(1).font = { bold: true };
    for (const r of list) ws.addRow(cols.map((c) => cell(r[c])));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function registerStorageRoutes(app, db) {
  const admin = { preHandler: app.requireRole('admin') };

  app.get('/api/admin/storage', admin, async () => {
    let dbBytes = null;
    try {
      dbBytes = Number((await db.query('select pg_database_size(current_database()) as b')).rows[0].b);
    } catch {
      dbBytes = db.engine === 'pglite' ? dirBytes(config.pgliteDir) : null;
    }
    const photos = (await db.query('select count(*)::int as n, coalesce(sum(bytes), 0)::bigint as b from photos')).rows[0];
    const byMonth = (await db.query(
      `select to_char(uploaded_at at time zone 'Asia/Kolkata', 'YYYY-MM') as month, count(*)::int as n, coalesce(sum(bytes), 0)::bigint as b
       from photos group by 1 order by 1 desc limit 36`,
    )).rows.map((r) => ({ month: r.month, count: r.n, bytes: Number(r.b) }));
    const count = async (sql) => (await db.query(sql)).rows[0].n;
    const rows = {
      stretches: await count('select count(*)::int as n from stretches'),
      history: await count('select count(*)::int as n from stretch_versions'),
      issues: await count('select count(*)::int as n from issues'),
      issue_history: await count('select count(*)::int as n from issue_events'),
      requests: await count('select count(*)::int as n from change_requests'),
      labour: await count('select count(*)::int as n from labour_logs'),
      audit: await count('select count(*)::int as n from audit_log'),
    };
    let disk = null;
    try {
      fs.mkdirSync(config.uploadDir, { recursive: true });
      const s = fs.statfsSync(config.uploadDir);
      disk = { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
    } catch { /* not available on every platform */ }
    const purges = (await db.query(
      `select p.id, p.at, to_char(p.before_date, 'YYYY-MM-DD') as before_date, p.categories, p.summary, p.bytes_freed, u.name as user_name
       from storage_purges p left join users u on u.id = p.user_id order by p.at desc limit 50`,
    )).rows;
    return { categories: CATEGORIES, db_bytes: dbBytes, photos: { count: photos.n, bytes: Number(photos.b), by_month: byMonth }, rows, disk, purges };
  });

  app.post('/api/admin/storage/preview', admin, async (req, reply) => {
    const b = body.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: b.error.issues.map((i) => i.message).join('; ') });
    const { summary, files } = await dryRun(db, b.data.categories, b.data.before);
    return { summary, bytes: files.reduce((a, f) => a + f.bytes, 0) };
  });

  // Archive of exactly what a clean-up would delete: an Excel workbook of the rows and the photo files, as one zip.
  app.get('/api/admin/storage/archive', admin, async (req, reply) => {
    const b = body.safeParse({ categories: String(req.query.categories ?? '').split(',').filter(Boolean), before: req.query.before });
    if (!b.success) return reply.code(400).send({ error: b.error.issues.map((i) => i.message).join('; ') });
    const { rows, files } = await dryRun(db, b.data.categories, b.data.before);
    const zip = new yazl.ZipFile();
    zip.addBuffer(await archiveWorkbook(rows, b.data.before), 'records.xlsx');
    // Complete records (Excel cells are limited to 32,767 characters, e.g. a long road's geometry).
    zip.addBuffer(Buffer.from(JSON.stringify(rows, null, 1)), 'records.json');
    let missing = 0;
    for (const f of files) {
      const abs = path.join(config.uploadDir, f.path);
      if (fs.existsSync(abs)) zip.addFile(abs, `photos/${f.path}`, { compress: false });
      else missing++;
    }
    zip.addBuffer(Buffer.from(
      `Madhira UGD Tracker archive\r\nEverything before ${b.data.before} in: ${b.data.categories.join(', ')}\r\n` +
      `records.xlsx: the records, one sheet each (very long values are shortened; records.json has them in full).\r\nphotos/: ${files.length - missing} photo files, by year and month of upload` +
      `${missing ? ` (${missing} files were already missing on the server)` : ''}.\r\n`,
    ), 'README.txt');
    zip.end();
    reply
      .header('content-type', 'application/zip')
      .header('content-disposition', `attachment; filename="UGD-archive-before-${b.data.before}.zip"`);
    return reply.send(zip.outputStream);
  });

  app.post('/api/admin/storage/purge', admin, async (req, reply) => {
    const b = body.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: b.error.issues.map((i) => i.message).join('; ') });
    if (b.data.confirm !== 'DELETE') return reply.code(400).send({ error: 'Type DELETE to confirm.' });
    const { categories, before } = b.data;
    const out = await db.tx(async (q) => {
      const r = await runPurge(q, categories, before);
      const freed = r.files.reduce((a, f) => a + f.bytes, 0);
      await q.query(
        'insert into storage_purges (user_id, before_date, categories, summary, bytes_freed) values ($1, $2, $3, $4, $5)',
        [req.user.id, before, categories, JSON.stringify(r.summary), freed],
      );
      return { ...r, freed };
    });
    // Files go only after the database change is committed.
    for (const f of out.files) fs.rmSync(path.join(config.uploadDir, f.path), { force: true });
    // Let PostgreSQL reuse the freed space (runs outside a transaction; harmless if not supported).
    try { await db.query('vacuum'); } catch { /* ignore */ }
    for (const entity of ['stretch', 'issue', 'change_request']) publish({ entity, action: 'purge', by: req.user.name });
    req.log.warn({ categories, before, summary: out.summary }, 'storage clean-up');
    return { summary: out.summary, bytes_freed: out.freed };
  });
}

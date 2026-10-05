/**
 * ONE-TIME FRESH START. Deletes everything people have recorded, and keeps what the application is built on.
 *
 *   Deleted: road stretches and their history, issues, change requests, approved manhole/pipe additions and
 *            removals, labour entries, photos (files too), activity/sign-in logs, Storage clean-up log.
 *   Kept:    user accounts and their passwords, the Madhira plan (imagery, wards, zones, the sewer network from the
 *            drawings, progress baseline: all in data/processed, never touched here), and the database structure.
 *
 * Never part of an upgrade. Take a backup first (sh deploy/backup.sh). Then, with Docker:
 *   docker compose exec app node server/scripts/reset-records.mjs --confirm "DELETE ALL RECORDS"
 *   docker compose restart app
 * Without the --confirm text it only shows what would be deleted.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { openDb } from '../src/db.js';

const PHRASE = 'DELETE ALL RECORDS';
const i = process.argv.indexOf('--confirm');
const confirmed = i > 0 && process.argv[i + 1] === PHRASE;

// Child tables first.
const TABLES = [
  ['issue_events', 'issue history'], ['issues', 'issues'],
  ['stretch_versions', 'road history'], ['stretches', 'road stretches'],
  ['network_edits', 'approved manhole/pipe changes'], ['change_requests', 'change requests'],
  ['labour_entry_events', 'labour history'], ['labour_entries', 'labour entries'], ['labour_logs', 'labour (by ward, before v1.2)'],
  ['photos', 'photos'], ['audit_log', 'sign-in and admin log'], ['storage_purges', 'clean-up log'],
  ['request_keys', 'resend keys'], ['counters', 'code counters (codes start again at 001)'],
];

const db = await openDb();
const counts = [];
for (const [t, label] of TABLES) {
  const n = (await db.query(`select count(*)::int as n from ${t}`)).rows[0].n;
  counts.push([label, n]);
}
const users = (await db.query('select count(*)::int as n from users')).rows[0].n;
console.log(`Database: ${db.engine}${config.databaseUrl ? '' : ` (${config.pgliteDir})`}`);
console.log('Would delete:');
for (const [label, n] of counts) console.log(`  ${String(n).padStart(7)}  ${label}`);
console.log(`Kept: ${users} user accounts, the map and plan data, the database structure.`);

if (!confirmed) {
  console.log(`\nNothing deleted. To delete, take a backup first, then run again with:  --confirm "${PHRASE}"`);
  await db.close();
  process.exit(0);
}

const files = (await db.query('select path from photos')).rows.map((r) => r.path);
await db.tx(async (q) => {
  for (const [t] of TABLES) await q.query(`delete from ${t}`);
});
let removed = 0;
for (const f of files) {
  const abs = path.join(config.uploadDir, f);
  if (fs.existsSync(abs)) { fs.rmSync(abs, { force: true }); removed++; }
}
try { await db.query('vacuum'); } catch { /* not essential */ }
await db.close();
console.log(`\nDone: records deleted, ${removed} photo files removed. Restart the app now (docker compose restart app).`);

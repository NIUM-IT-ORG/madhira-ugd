/**
 * Upgrade check: proves an upgrade keeps every record. Read-only (safe on a copy of the live data).
 *
 *   node server/test/upgrade-check.mjs snapshot <url> <admin email> <password> before.json   (on the old version)
 *   ... upgrade the server ...
 *   node server/test/upgrade-check.mjs compare  <url> <admin email> <password> before.json   (on the new version)
 *
 * Compares: users, road stretches (status, stage, approval, every history entry), issues, change requests, the
 * network (manholes, pipes), photos, and labour (added up per zone and day, so the v1.2 ward-to-zone conversion
 * is checked too). New accounts added by the release are listed, never counted as a loss.
 */
import fs from 'node:fs';

const [mode, base, email, password, file] = process.argv.slice(2);
if (!['snapshot', 'compare'].includes(mode) || !file) {
  console.log('usage: upgrade-check.mjs snapshot|compare <url> <admin email> <password> <file.json>');
  process.exit(2);
}

const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'x-ugd': '1', 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
if (!r.ok) { console.log('sign-in failed', r.status); process.exit(2); }
const cookie = r.headers.get('set-cookie').split(';')[0];
const get = async (u) => { const x = await fetch(base + u, { headers: { cookie } }); if (!x.ok) throw new Error(`${u}: ${x.status}`); return x.json(); };
const zoneOfWard = new Map((await get('/data/wards.geojson')).features.map((f) => [f.properties.ward, f.properties.zone]));

async function snapshot() {
  const users = (await get('/api/users')).users.map((u) => `${u.email}|${u.role}|${u.active}`).sort();
  const stretches = {};
  for (const f of (await get('/api/stretches')).features) {
    const d = await get(`/api/stretches/${f.id}`);
    const p = d.stretch.properties;
    stretches[p.code] = {
      version: p.version, stage: p.stage, approval: p.approval, record_state: p.record_state, status: JSON.stringify(p.status),
      history: d.versions.map((v) => `${v.version}:${v.kind}`).sort(),
    };
  }
  const issues = Object.fromEntries((await get('/api/issues')).issues.map((i) => [i.code, `${i.kind}|${i.status}|${i.count}|${i.ward}`]));
  const requests = Object.fromEntries((await get('/api/change-requests?status=all')).requests.map((c) => [c.code, `${c.entity}|${c.action}|${c.status}`]));
  const net = await get('/api/network');
  const lab = await get('/api/labour');
  const rows = lab.entries ?? lab.labour ?? [];
  const labour = {};
  for (const l of rows) {
    const zone = l.zone ?? zoneOfWard.get(l.ward);
    const k = `${l.log_date}|z${zone}`;
    labour[k] = labour[k] ?? { labourers: 0, machines: 0 };
    labour[k].labourers += l.labourers;
    labour[k].machines += l.machines;
  }
  let photos = null;
  try { photos = (await get('/api/admin/storage')).photos.count } catch { /* older version without the Storage page */ }
  return { users, stretches, issues, requests, network: { pipes: net.pipes.features.length, manholes: net.manholes.features.length }, labour, photos };
}

const now = await snapshot();
if (mode === 'snapshot') {
  fs.writeFileSync(file, JSON.stringify(now, null, 1));
  console.log(`snapshot: ${now.users.length} users, ${Object.keys(now.stretches).length} stretches, ${Object.keys(now.issues).length} issues, ` +
    `${Object.keys(now.requests).length} requests, ${now.network.manholes} manholes, ${now.network.pipes} pipes, ${Object.keys(now.labour).length} zone-days of labour, ${now.photos ?? '?'} photos`);
  process.exit(0);
}

const before = JSON.parse(fs.readFileSync(file, 'utf8'));
let lost = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) lost++; };
// Order-independent comparison (records can come back in a different order).
const canon = (v) => (v && typeof v === 'object' && !Array.isArray(v)
  ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`
  : Array.isArray(v) ? `[${v.map(canon).join(',')}]` : JSON.stringify(v));
const same = (a, b) => canon(a) === canon(b);
/** Every value of the old record is still there and unchanged (a release may add fields with defaults). */
const kept = (old, now) => {
  if (old && typeof old === 'object' && !Array.isArray(old)) return !!now && typeof now === 'object' && Object.keys(old).every((k) => kept(old[k], now[k]));
  return canon(old) === canon(now);
};

const missingUsers = before.users.filter((u) => !now.users.includes(u));
check(!missingUsers.length, `all ${before.users.length} users kept${missingUsers.length ? `; missing: ${missingUsers.join(', ')}` : ''}`);
const added = now.users.filter((u) => !before.users.includes(u));
if (added.length) console.log(`      new accounts from this release: ${added.map((u) => u.split('|')[0]).join(', ')}`);
for (const [code, s] of Object.entries(before.stretches)) {
  const n = now.stretches[code];
  check(!!n && same({ ...s, history: undefined, status: undefined }, { ...n, history: undefined, status: undefined })
    && kept(JSON.parse(s.status), JSON.parse(n.status)) && s.history.every((h) => n.history.includes(h)),
    `stretch ${code}: status, stage, approval and ${s.history.length} history entries kept`);
}
check(same(before.issues, now.issues), `all ${Object.keys(before.issues).length} issues kept unchanged`);
check(same(before.requests, now.requests), `all ${Object.keys(before.requests).length} change requests kept`);
check(same(before.network, now.network), `network kept (${now.network.manholes} manholes, ${now.network.pipes} pipes)`);
check(same(before.labour, now.labour), `labour kept: ${Object.keys(before.labour).length} zone-days, same totals`);
if (before.photos != null) check(before.photos === now.photos, `all ${before.photos} photos kept`);
console.log(lost ? `\n${lost} check(s) failed: data was lost or changed` : '\nUpgrade kept every record.');
process.exit(lost ? 1 : 0);

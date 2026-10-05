/**
 * Demo data for a TEST copy only (never the live system): one stretch in every stage, issues, proposals,
 * and a "Demo AEE" account.
 *   SEED_EMAIL=<admin email> SEED_PASSWORD=<admin password> node server/test/demo-seed.mjs https://test.example.in
 * The admin must already have set its own password. Without SEED_* the local var/dev-credentials.json is used.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const base = process.argv[2] ?? 'http://localhost:8080';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const credFile = path.join(root, 'var', 'dev-credentials.json');
const creds = process.env.SEED_EMAIL
  ? { admin: { email: process.env.SEED_EMAIL, password: process.env.SEED_PASSWORD } }
  : JSON.parse(fs.readFileSync(credFile, 'utf8'));
const pipes = JSON.parse(fs.readFileSync(path.join(root, 'data', 'processed', 'pipes.geojson'), 'utf8')).features;

function client() {
  let cookie = '';
  return async (method, url, body) => {
    const headers = { 'x-ugd': '1', cookie };
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(base + url, { method, headers, body: payload });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${json.error}`);
    return json;
  };
}

const JPG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
async function photo(call, lng, lat) {
  const fd = new FormData();
  fd.append('lat', String(lat));
  fd.append('lng', String(lng));
  fd.append('file', new Blob([JPG], { type: 'image/jpeg' }), 'p.jpg');
  return (await call('POST', '/api/photos', fd)).id;
}

/** A run of n connected reaches starting from a pipe in the ward (follows from->to). */
function chain(ward, n, skip = 0) {
  const inWard = pipes.filter((p) => p.properties.ward === ward && p.properties.dia_mm === 150);
  const byFrom = new Map();
  for (const p of pipes) byFrom.set(p.properties.from, p);
  for (const start of inWard.slice(skip)) {
    const out = [start];
    let cur = start;
    while (out.length < n) {
      const next = byFrom.get(cur.properties.to);
      if (!next || out.includes(next) || next.properties.ward !== ward) break;
      out.push(next);
      cur = next;
    }
    if (out.length === n) return out;
  }
  return inWard.slice(skip, skip + n);
}

const admin = client();
const aee = client();
await admin('POST', '/api/auth/login', { email: creds.admin.email, password: creds.admin.password });

let demo = process.env.SEED_AEE_EMAIL ? { email: process.env.SEED_AEE_EMAIL, password: process.env.SEED_AEE_PASSWORD } : creds.demo_aee;
if (!demo) {
  const r = await admin('POST', '/api/users', { email: 'demo.aee@madhira.local', name: 'Demo AEE', designation: 'AEE (demo)', role: 'editor', all_wards: true });
  const pw = `Demo-${Math.random().toString(36).slice(2, 10)}`;
  await aee('POST', '/api/auth/login', { email: r.user.email, password: r.temp_password });
  await aee('POST', '/api/auth/password', { current: r.temp_password, next: pw });
  demo = { email: r.user.email, password: pw };
  creds.demo_aee = demo;
  if (process.env.SEED_EMAIL) console.log(`Demo AEE account: ${demo.email} / ${demo.password}`);
  else fs.writeFileSync(credFile, JSON.stringify(creds, null, 1), { mode: 0o600 });
} else {
  await aee('POST', '/api/auth/login', demo);
}

const plans = [
  { ward: 9, name: 'Teachers Colony 2nd lane', status: {} },
  { ward: 13, name: 'Muslim Bazar road', status: { sewer: { pipeline: 'laid', manholes_built: 2 }, excavation: { stage: 'trench_open' }, utilities: { drain_clogged: true, taps_broken: 2 } }, photo: true },
  { ward: 15, name: 'Main Road (Varthaka Sangham)', status: { sewer: { pipeline: 'laid', manholes_built: 4, ics_built: 6 }, excavation: { stage: 'backfilled' }, restoration: { stage: 'pending' }, hazards: { potholes: 2, water_stagnation: true } }, photo: true },
  { ward: 17, name: 'Sai Baba Temple street', status: { sewer: { pipeline: 'laid', manholes_built: 3, ics_built: 4 }, excavation: { stage: 'backfilled' }, restoration: { stage: 'restored_curing_pending' } }, photo: true },
  { ward: 21, name: 'RCM Church road', status: { sewer: { pipeline: 'laid', manholes_built: 3, ics_built: 5 }, excavation: { stage: 'backfilled' }, restoration: { stage: 'restored_curing_done' } }, photo: true },
  { ward: 18, name: 'Ladak Bazar main lane', status: { sewer: { pipeline: 'laid', manholes_built: 4, ics_built: 8 }, excavation: { stage: 'backfilled' }, restoration: { stage: 'restored_curing_done' } }, photo: true, approve: true },
  { ward: 12, name: 'Vaddera Bazar', status: { sewer: { pipeline: 'partial', pipe_laid_m: 40, manholes_built: 1 }, excavation: { stage: 'trench_open' }, motorable: 'no' }, photo: true },
  { ward: 5, name: 'Madupalli school road', status: { sewer: { pipeline: 'laid', manholes_built: 3 }, excavation: { stage: 'backfilled' }, utilities: { water_leaks: 1, taps_broken: 3, taps_restored: 1 } }, photo: true, by: 'aee' },
];

const existing = new Set((await admin('GET', '/api/stretches')).features.map((f) => f.properties.name));
for (const [i, p] of plans.entries()) {
  if (existing.has(p.name)) continue;
  const c = chain(p.ward, 3, i);
  const geom = { type: 'MultiLineString', coordinates: c.map((x) => x.geometry.coordinates) };
  const [lng, lat] = c[0].geometry.coordinates[0];
  const who = p.by === 'aee' ? aee : admin;
  const photos = p.photo ? [await photo(who, lng, lat)] : [];
  const r = await who('POST', '/api/stretches', { name: p.name, geometry: geom, pipe_ids: c.map((x) => x.properties.id), status: p.status, photos, gps: { lat, lng, accuracy: 6 }, note: 'Demo record' });
  if (p.approve) await admin('POST', `/api/stretches/${r.id}/approve`, { note: 'Inspected (demo)' });
  console.log(`${r.code}  ${p.name}  ${r.record_state ?? ''}`);
}

// A manual issue pin, a proposed manhole and a proposed pipe deletion (by the AEE).
const w14 = pipes.find((x) => x.properties.ward === 14).geometry.coordinates[0];
await aee('POST', '/api/issues', { kind: 'drain_clogged', location: [w14[0] + 0.0001, w14[1] + 0.00005], count: 1, severity: 'high', description: 'Gravel dumped in side drain (demo)', photos: [await photo(aee, w14[0], w14[1])] });
const w10 = pipes.find((x) => x.properties.ward === 10);
await aee('POST', '/api/change-requests', { entity: 'manhole', action: 'add', reason: 'New connection point near the market (demo)', payload: { lon: w10.geometry.coordinates[0][0] + 0.00025, lat: w10.geometry.coordinates[0][1] + 0.0001, label: '9901', gl: 58.9, il: 57.2 } });
const w16 = pipes.find((x) => x.properties.ward === 16);
await aee('POST', '/api/change-requests', { entity: 'pipe', action: 'delete', target_id: w16.properties.id, reason: 'Duplicate of the line on the parallel lane (demo)' });
await aee('POST', '/api/labour', { log_date: new Date().toISOString().slice(0, 10), ward: 13, labourers: 18, machines: 1 });
await aee('POST', '/api/labour', { log_date: new Date().toISOString().slice(0, 10), ward: 5, labourers: 12, machines: 1 });
console.log('demo data added');

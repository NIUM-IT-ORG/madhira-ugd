/**
 * FULL end-to-end test of the API. It CREATES test users and records, so run it only against a test
 * copy (e.g. a local trial or a staging server), never the live system. For the live system use
 * postdeploy-check.mjs, which only reads.
 * Runs against a server (default http://localhost:8080).
 * Uses the first-run admin from var/first-admin.json and creates test users / records named "Test …".
 *   node server/test/smoke.mjs [baseUrl]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const base = process.argv[2] ?? 'http://localhost:8080';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// Admin login: SMOKE_EMAIL / SMOKE_PASSWORD, else the first-run admin file in var/.
const creds = process.env.SMOKE_EMAIL
  ? { email: process.env.SMOKE_EMAIL, password: process.env.SMOKE_PASSWORD }
  : JSON.parse(fs.readFileSync(path.join(root, 'var', 'first-admin.json'), 'utf8'));
const pipes = JSON.parse(fs.readFileSync(path.join(root, 'data', 'processed', 'pipes.geojson'), 'utf8')).features;

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failures++;
};

function client() {
  let cookie = '';
  async function call(method, url, body, { raw } = {}) {
    const headers = { 'x-ugd': '1', cookie };
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(base + url, { method, headers, body: payload });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    if (raw) return res;
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = { text }; }
    return { status: res.status, ...json };
  }
  return { call, get: (u) => call('GET', u), post: (u, b) => call('POST', u, b ?? {}), patch: (u, b) => call('PATCH', u, b), del: (u, b) => call('DELETE', u, b ?? {}) };
}

async function signIn(c, email, password) {
  const r = await c.post('/api/auth/login', { email, password });
  // One-time passwords must be replaced before anything else works (as for a real user).
  if (r.status === 200 && r.user.must_change_password) {
    const blocked = await c.get('/api/stretches');
    ok(blocked.status === 403, `${email}: blocked until the one-time password is replaced`);
    const next = `T-${Math.random().toString(36).slice(2, 12)}`;
    const ch = await c.post('/api/auth/password', { current: password, next });
    ok(ch.status === 200, `${email}: sets a new password`);
  }
  return r;
}

async function uploadPhoto(c) {
  // 1x1 JPEG
  const jpg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
  const fd = new FormData();
  fd.append('lat', '16.9235');
  fd.append('lng', '80.3686');
  fd.append('file', new Blob([jpg], { type: 'image/jpeg' }), 'p.jpg');
  return c.call('POST', '/api/photos', fd);
}

const admin = client();
const aee = client();
const viewer = client();

// ---- auth
ok((await admin.get('/api/stretches')).status === 401, 'API refuses anonymous requests');
ok((await admin.get('/data/wards.geojson')).status === 401, 'map data refuses anonymous requests');
const noHeader = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
ok(noHeader.status === 403, 'state-changing call without app header is refused (CSRF guard)');
ok((await signIn(admin, creds.email, 'wrong-password')).status === 401, 'wrong password refused');
const login = await signIn(admin, creds.email, creds.password);
ok(login.status === 200 && login.user.role === 'admin', 'admin signs in');

// ---- users
const stamp = Date.now();
const mk = await admin.post('/api/users', { email: `test.aee.${stamp}@madhira.local`, name: 'Test AEE', designation: 'AEE', role: 'editor', wards: [9, 10, 21, 22] });
ok(mk.status === 200 && mk.temp_password, 'admin creates an AEE (editor) for wards 9, 10, 21, 22');
const mv = await admin.post('/api/users', { email: `test.viewer.${stamp}@madhira.local`, name: 'Test Viewer', role: 'viewer' });
ok(mv.status === 200, 'admin creates a viewer');
ok((await signIn(aee, mk.user.email, mk.temp_password)).status === 200, 'AEE signs in with one-time password');
ok((await signIn(viewer, mv.user.email, mv.temp_password)).status === 200, 'viewer signs in');
ok((await aee.post('/api/users', { email: 'x@y.z', name: 'X Y', role: 'admin' })).status === 403, 'AEE cannot create users');

// pick two connected pipes in ward 10 for a stretch, and one in ward 5 (not assigned)
const w10 = pipes.filter((p) => p.properties.ward === 10);
const chainA = w10[0];
const chainB = w10.find((p) => p !== chainA && (p.properties.from === chainA.properties.to || p.properties.to === chainA.properties.from)) ?? w10[1];
const geom = { type: 'MultiLineString', coordinates: [chainA.geometry.coordinates, chainB.geometry.coordinates] };
const w5 = pipes.find((p) => p.properties.ward === 5);

// ---- stretch by AEE -> proposed + change request
const photo = await uploadPhoto(aee);
ok(photo.status === 200 && photo.id, 'AEE uploads a photo');
const bad = await aee.post('/api/stretches', { name: 'Test road', geometry: geom, pipe_ids: [chainA.properties.id, chainB.properties.id], status: { restoration: { stage: 'restored_curing_pending' } } });
if (bad.status !== 400) console.log('DEBUG bad', JSON.stringify(bad));
ok(bad.status === 400 && /photo/i.test(bad.error), 'restoration claim without photo is refused');
const st = await aee.post('/api/stretches', {
  name: 'Test road near bus stand', geometry: geom, pipe_ids: [chainA.properties.id, chainB.properties.id],
  status: { sewer: { pipeline: 'laid', manholes_built: 2 }, excavation: { stage: 'trench_open' }, utilities: { drain_clogged: true, taps_broken: 3 } },
  photos: [photo.id], gps: { lat: 16.9235, lng: 80.3686, accuracy: 8 }, note: 'Test survey',
});
if (st.status !== 200) console.log('DEBUG st', JSON.stringify(st));
ok(st.status === 200 && st.record_state === 'proposed', `AEE adds stretch ${st.code} -> proposed`);
ok((await aee.post('/api/stretches', { geometry: { type: 'LineString', coordinates: w5.geometry.coordinates } })).status === 403, 'AEE cannot add in an unassigned ward');
ok((await viewer.post('/api/stretches', { geometry: geom })).status === 403, 'viewer cannot add stretches');

let detail = await admin.get(`/api/stretches/${st.id}`);
ok(detail.stretch.properties.stage === 'in_progress' && detail.issues.length === 2, 'stage in progress; 2 issues raised (drain, taps)');
ok(detail.versions[0].flagged_far === true || detail.versions[0].gps_distance_m != null, `GPS distance recorded (${detail.versions[0].gps_distance_m} m)`);

const crs = await admin.get('/api/change-requests?status=pending');
const crStretch = crs.requests.find((r) => r.target_id === st.id);
ok(!!crStretch, `change request ${crStretch?.code} waits for approval`);
ok((await aee.post(`/api/change-requests/${crStretch.id}/approve`)).status === 403, 'AEE cannot approve');
ok((await admin.post(`/api/change-requests/${crStretch.id}/approve`)).status === 200, 'Commissioner approves the new stretch');
detail = await admin.get(`/api/stretches/${st.id}`);
ok(detail.stretch.properties.record_state === 'active', 'stretch now active');

// ---- update with conflict detection
const v = detail.stretch.properties.version;
const u1 = await aee.patch(`/api/stretches/${st.id}`, { base_version: v, changes: [{ path: 'excavation.stage', to: 'backfilled' }], note: 'Back-filled' });
ok(u1.status === 200 && u1.version === v + 1, 'AEE records back-fill');
const u2 = await admin.patch(`/api/stretches/${st.id}`, { base_version: v, changes: [{ path: 'excavation.stage', to: 'road_cut' }] });
ok(u2.status === 409, 'stale edit of the same field is refused (conflict)');
const u3 = await admin.patch(`/api/stretches/${st.id}`, { base_version: v, changes: [{ path: 'sewer.ics_built', to: 4 }] });
ok(u3.status === 200, 'stale edit of a different field is merged');
ok((await aee.patch(`/api/stretches/${st.id}`, { base_version: u3.version, changes: [{ path: 'sewer.manholes_built', to: -1 }] })).status === 400, 'negative count refused');
ok((await aee.patch(`/api/stretches/${st.id}`, { base_version: u3.version, changes: [{ path: 'nonsense', to: 1 }] })).status === 400, 'unknown field refused');

// ---- restoration -> approval
const photo2 = await uploadPhoto(aee);
const r1 = await aee.patch(`/api/stretches/${st.id}`, {
  base_version: u3.version, photos: [photo2.id],
  changes: [{ path: 'restoration.stage', to: 'restored_curing_done' }, { path: 'utilities.drain_clogged', to: false }],
});
ok(r1.status === 200, 'AEE marks CC restored, curing done, drain cleared (with photo)');
detail = await admin.get(`/api/stretches/${st.id}`);
ok(detail.stretch.properties.stage === 'awaiting_approval' && detail.stretch.properties.approval === 'pending', 'awaiting Commissioner approval');
ok(detail.issues.find((i) => i.kind === 'drain_clogged').status === 'resolved', 'drain issue auto-resolved');
ok((await aee.post(`/api/stretches/${st.id}/approve`)).status === 403, 'AEE cannot approve restoration');
ok((await admin.post(`/api/stretches/${st.id}/approve`, { note: 'Inspected' })).status === 200, 'Commissioner approves restoration');
detail = await admin.get(`/api/stretches/${st.id}`);
ok(detail.stretch.properties.stage === 'approved', 'stretch is green (approved)');

// ---- issue resolution flows back to the stretch
const taps = detail.issues.find((i) => i.kind === 'taps_broken' && i.status !== 'resolved');
ok((await aee.patch(`/api/issues/${taps.id}`, { status: 'resolved' })).status === 400, 'resolving needs a note');
ok((await aee.patch(`/api/issues/${taps.id}`, { status: 'resolved', note: 'Plumber reconnected 3 taps' })).status === 200, 'AEE resolves taps issue');
detail = await admin.get(`/api/stretches/${st.id}`);
ok(detail.stretch.properties.status.utilities.taps_restored === 3, 'stretch shows 3 taps restored');
ok(detail.stretch.properties.open_issues === 0, 'no open issues on the stretch');

// ---- bulk
const bulk = await aee.post('/api/stretches/bulk', { ids: [st.id], changes: [{ path: 'motorable', to: 'difficult' }], note: 'Bulk test' });
ok(bulk.status === 200 && bulk.results[0].ok, 'bulk update applies');

// ---- network change requests
const mhReq = await aee.post('/api/change-requests', {
  entity: 'manhole', action: 'add', reason: 'Test new manhole',
  payload: { lon: chainA.geometry.coordinates[0][0] + 0.0002, lat: chainA.geometry.coordinates[0][1] + 0.0001, label: `9${String(stamp).slice(-3)}`, gl: 59.1, il: 57.6 },
});
ok(mhReq.status === 200 && mhReq.request.status === 'pending', `AEE proposes manhole ${mhReq.request?.target_id}`);
const pipeReq = await aee.post('/api/change-requests', {
  entity: 'pipe', action: 'add', reason: 'Test new pipe',
  payload: { from: mhReq.request.target_id, to: chainA.properties.from, dia_mm: 150, slope: '1/150' },
});
ok(pipeReq.status === 200, `AEE proposes pipe ${pipeReq.request?.target_id} to the new manhole`);
ok((await admin.post(`/api/change-requests/${pipeReq.request.id}/approve`)).status === 400, 'pipe cannot be approved before its new manhole');
ok((await admin.post(`/api/change-requests/${mhReq.request.id}/approve`)).status === 200, 'Commissioner approves the manhole');
ok((await admin.post(`/api/change-requests/${pipeReq.request.id}/approve`)).status === 200, 'Commissioner approves the pipe');
let net = await admin.get('/api/network');
ok(net.pipes.features.some((f) => f.id === pipeReq.request.target_id), 'new pipe is in the network');
const delReq = await aee.post('/api/change-requests', { entity: 'pipe', action: 'delete', target_id: pipeReq.request.target_id });
ok(delReq.status === 400, 'deletion request needs a reason');
const delReq2 = await aee.post('/api/change-requests', { entity: 'pipe', action: 'delete', target_id: pipeReq.request.target_id, reason: 'Test removal' });
ok(delReq2.status === 200, 'AEE requests pipe deletion');
ok((await admin.post(`/api/change-requests/${delReq2.request.id}/reject`)).status === 400, 'rejection needs a reason');
ok((await admin.post(`/api/change-requests/${delReq2.request.id}/reject`, { note: 'Keep it' })).status === 200, 'Commissioner rejects the deletion');
const mhDel = await admin.post('/api/change-requests', { entity: 'manhole', action: 'delete', target_id: mhReq.request.target_id, reason: 'Test cleanup' });
ok(mhDel.status === 200 && mhDel.request.status === 'approved', "Commissioner's own deletion applies at once");
net = await admin.get('/api/network');
ok(!net.pipes.features.some((f) => f.id === pipeReq.request.target_id), 'deleting the manhole removed its pipe too');

// ---- stretch deletion request
const sdel = await aee.del(`/api/stretches/${st.id}`, { reason: 'Test cleanup' });
ok(sdel.status === 200 && sdel.pending, 'AEE stretch deletion becomes a request');
const pend = (await admin.get('/api/change-requests?status=pending')).requests.find((r) => r.target_id === st.id && r.action === 'delete');
ok((await admin.post(`/api/change-requests/${pend.id}/approve`)).status === 200, 'Commissioner approves stretch deletion');
ok(!(await admin.get('/api/stretches')).features.some((f) => f.id === st.id), 'stretch removed from the map');
detail = await admin.get(`/api/stretches/${st.id}`);
ok(detail.versions.length >= 8, `full history kept (${detail.versions.length} versions)`);

// ---- misc
ok((await aee.post('/api/labour', { log_date: '2026-10-01', ward: 10, labourers: 24, machines: 2 })).status === 200, 'AEE logs labour for ward 10');
ok((await aee.post('/api/labour', { log_date: '2026-10-01', ward: 5, labourers: 10 })).status === 403, 'AEE cannot log labour for unassigned ward');
const act = await viewer.get('/api/activity?limit=20');
ok(act.status === 200 && act.activity.length > 5, `viewer sees activity feed (${act.activity.length} items)`);
ok((await viewer.patch(`/api/issues/${taps.id}`, { status: 'open', note: 'x' })).status === 403, 'viewer cannot change issues');

// ---- clean up test users (deactivate)
await admin.patch(`/api/users/${mk.user.id}`, { active: false });
await admin.patch(`/api/users/${mv.user.id}`, { active: false });
ok((await aee.get('/api/stretches')).status === 401, 'deactivated user is signed out');

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);

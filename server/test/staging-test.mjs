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
const wards = JSON.parse(fs.readFileSync(path.join(root, 'data', 'processed', 'wards.geojson'), 'utf8')).features;
const { midpoint, wardAt } = await import('../../shared/geo.ts');

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failures++;
};

function client() {
  let cookie = '';
  async function call(method, url, body, { raw, headers: extra } = {}) {
    const headers = { 'x-ugd': '1', cookie, ...(extra ?? {}) };
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
ok((await aee.post('/api/labour', { log_date: '2026-10-01', zone: 1, labourers: 24, machines: 2 })).status === 200, 'AEE logs labour for zone 1 (wards 9, 10 are in it)');
ok((await aee.post('/api/labour', { log_date: '2026-10-01', zone: 2, labourers: 10 })).status === 403, 'AEE cannot log labour for a zone with none of their wards');
const act = await viewer.get('/api/activity?limit=20');
ok(act.status === 200 && act.activity.length > 5, `viewer sees activity feed (${act.activity.length} items)`);
ok((await viewer.patch(`/api/issues/${taps.id}`, { status: 'open', note: 'x' })).status === 403, 'viewer cannot change issues');

// ---- v1.1: pipes outside the ward outlines can be recorded (nearest ward)
const outside = pipes.find((p) => !wardAt(midpoint(p.geometry), wards).inside && !wardAt(midpoint(p.geometry), wards).inside);
const near = wardAt(midpoint(outside.geometry), wards);
const so = await admin.post('/api/stretches', { name: 'Test outside road', geometry: { type: 'MultiLineString', coordinates: [outside.geometry.coordinates] }, pipe_ids: [outside.properties.id] });
if (so.status !== 200) console.log('DEBUG so', JSON.stringify(so));
ok(so.status === 200, `stretch on a pipe outside the ward outlines is accepted (${outside.properties.id})`);
let od = await admin.get(`/api/stretches/${so.id}`);
ok(od.stretch.properties.ward === near.ward && od.stretch.properties.outside_ward === true, `it goes to the nearest ward ${near.ward}, flagged outside`);

// ---- v1.1: water pipe leaks can be marked fixed; damage photos are optional
let ov = od.stretch.properties.version;
const l1 = await admin.patch(`/api/stretches/${so.id}`, { base_version: ov, changes: [{ path: 'utilities.water_leaks', to: 2 }] });
ok(l1.status === 200, 'damage (2 leaks) recorded without a photo');
od = await admin.get(`/api/stretches/${so.id}`);
ok(od.issues.find((i) => i.kind === 'water_leak' && i.status !== 'resolved')?.count === 2, 'leak issue raised with count 2');
ok((await admin.patch(`/api/stretches/${so.id}`, { base_version: l1.version, changes: [{ path: 'utilities.water_leaks_fixed', to: 3 }] })).status === 400, 'more leaks fixed than reported is refused');
const l2 = await admin.patch(`/api/stretches/${so.id}`, { base_version: l1.version, changes: [{ path: 'utilities.water_leaks_fixed', to: 1 }] });
od = await admin.get(`/api/stretches/${so.id}`);
ok(l2.status === 200 && od.issues.find((i) => i.kind === 'water_leak' && i.status !== 'resolved')?.count === 1, '1 of 2 leaks fixed: issue count 1');
await admin.patch(`/api/stretches/${so.id}`, { base_version: l2.version, changes: [{ path: 'utilities.water_leaks_fixed', to: 2 }] });
od = await admin.get(`/api/stretches/${so.id}`);
ok(!od.issues.some((i) => i.kind === 'water_leak' && i.status !== 'resolved') && od.stretch.properties.open_issues === 0, 'all leaks fixed: issue resolved');

// ---- v1.1: report issue needs a remark, photo optional
const loc = chainA.geometry.coordinates[0];
ok((await aee.post('/api/issues', { kind: 'other', location: loc })).status === 400, 'issue without a remark is refused');
const ni = await aee.post('/api/issues', { kind: 'other', location: loc, description: 'Test remark, no photo' });
ok(ni.status === 200, 'issue with a remark and no photo is accepted');
const xl = await admin.call('GET', '/api/export/issues.xlsx?ward=10&status=open', undefined, { raw: true });
ok(xl.status === 200 && /spreadsheet/.test(xl.headers.get('content-type')), 'filtered issues Excel downloads');

// ---- v1.1: storage page (Commissioner only)
ok((await aee.get('/api/admin/storage')).status === 403, 'AEE cannot open the storage page');
const sto = await admin.get('/api/admin/storage');
ok(sto.status === 200 && sto.categories.length === 8 && sto.rows.history > 0, `storage usage (${sto.rows.history} history rows, ${sto.photos.count} photos)`);
const tomorrow = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
const all = sto.categories.map((c) => c.key);
const pv = await admin.post('/api/admin/storage/preview', { categories: all, before: tomorrow });
ok(pv.status === 200 && pv.summary.history.rows > 0 && pv.summary.removed_stretches.rows >= 1, `preview: ${pv.summary.history.rows} history rows, ${pv.summary.removed_stretches.rows} removed stretches`);
ok((await admin.get('/api/admin/storage')).rows.history === sto.rows.history, 'preview deletes nothing');
const zip = await admin.call('GET', `/api/admin/storage/archive?categories=${all.join(',')}&before=${tomorrow}`, undefined, { raw: true });
const zb = Buffer.from(await zip.arrayBuffer());
ok(zip.status === 200 && zb.subarray(0, 2).toString() === 'PK' && zb.length > 1000, `archive downloads (${Math.round(zb.length / 1024)} KB zip)`);
ok((await admin.post('/api/admin/storage/purge', { categories: ['removed_stretches'], before: tomorrow })).status === 400, 'clean-up needs typed DELETE');
const pg = await admin.post('/api/admin/storage/purge', { categories: ['removed_stretches', 'cleanup_log'], before: tomorrow, confirm: 'DELETE' });
ok(pg.status === 200 && pg.summary.removed_stretches.rows >= 1, 'deleted stretches are purged');
ok((await admin.get(`/api/stretches/${st.id}`)).status === 404, 'the deleted test stretch is gone for good');
ok((await admin.get('/api/admin/storage')).purges.length === 1, 'the clean-up is recorded in the log');

// ---- v1.1 fixes: stale edits after a resolve or a history clean-up get a clear 409; open issues survive a purge
od = await admin.get(`/api/stretches/${so.id}`);
const vBase = od.stretch.properties.version;
const s2 = await admin.patch(`/api/stretches/${so.id}`, { base_version: vBase, changes: [{ path: "utilities.water_leaks", to: 3 }] });
const leakIssue = (await admin.get(`/api/stretches/${so.id}`)).issues.find((i) => i.kind === 'water_leak' && i.status !== 'resolved');
ok((await admin.patch(`/api/issues/${leakIssue.id}`, { status: 'resolved', note: 'Plumber fixed all 3' })).status === 200, 'Commissioner resolves the leak issue (leaks fixed = 3)');
const stale = await admin.patch(`/api/stretches/${so.id}`, { base_version: s2.version, changes: [{ path: 'utilities.water_leaks', to: 1 }] });
ok(stale.status === 409, `stale leak edit after the resolve is a conflict, not a 400 (${stale.status})`);
const manual = await admin.post('/api/issues', { kind: 'other', location: outside.geometry.coordinates[0], stretch_id: so.id, description: 'Test manual issue on the stretch' });
ok(manual.status === 200, 'manual issue reported on the stretch');
const before = (await admin.get(`/api/stretches/${so.id}`)).stretch.properties.version;
const hp = await admin.post('/api/admin/storage/purge', { categories: ['history'], before: tomorrow, confirm: 'DELETE' });
ok(hp.status === 200, `history purged (${hp.summary?.history?.rows} entries)`);
const afterPurge = await admin.get(`/api/stretches/${so.id}`);
ok(afterPurge.versions.length >= 1 && afterPurge.versions[0].version === before, 'the latest version is kept');
const stale2 = await admin.patch(`/api/stretches/${so.id}`, { base_version: 1, changes: [{ path: 'excavation.stage', to: 'road_cut' }] });
ok(stale2.status === 409, `edit based on purged history is a conflict (${stale2.status})`);
const tl = await admin.get('/api/stats/timeline');
ok(tl.status === 200 && tl.weeks.length > 0, 'dashboard timeline still works after the purge');
await admin.del(`/api/stretches/${so.id}`, { reason: 'Test cleanup' });
const rp = await admin.post('/api/admin/storage/purge', { categories: ['removed_stretches'], before: tomorrow, confirm: 'DELETE' });
ok(rp.status === 200 && rp.summary.removed_stretches.rows >= 1, `removed stretches purged (${rp.summary?.removed_stretches?.detail})`);
const kept = (await admin.get('/api/issues')).issues.find((i) => i.id === manual.id);
ok(!!kept && kept.status !== 'resolved' && !kept.stretch_id, 'the open manual issue survives, unlinked from the deleted road');

// ---- bug-fix regressions (v1.1 review)
const free = w10.filter((p) => p !== chainA && p !== chainB);
const one = (p) => ({ type: 'MultiLineString', coordinates: [p.geometry.coordinates] });
// shared pipes are refused
const sp1 = await admin.post('/api/stretches', { geometry: one(free[0]), pipe_ids: [free[0].properties.id] });
const sp2 = await admin.post('/api/stretches', { geometry: one(free[0]), pipe_ids: [free[0].properties.id] });
ok(sp1.status === 200 && sp2.status === 409, `a pipe cannot be in two stretches (${sp2.status})`);
// rejected restoration can be resubmitted; a redraw needs approving again
const ph3 = await uploadPhoto(admin);
const rs = await admin.patch(`/api/stretches/${sp1.id}`, { base_version: 1, photos: [ph3.id], changes: [{ path: 'restoration.stage', to: 'restored_curing_done' }] });
ok((await admin.post(`/api/stretches/${sp1.id}/reject`, { note: 'Cracks' })).status === 200, 'restoration rejected');
const ph4 = await uploadPhoto(admin);
const rs2 = await admin.patch(`/api/stretches/${sp1.id}`, { base_version: rs.version + 1, photos: [ph4.id], note: 'Relaid' });
let d1 = await admin.get(`/api/stretches/${sp1.id}`);
ok(rs2.status === 200 && d1.stretch.properties.approval === 'pending', `resubmitted with a new photo goes back for approval (${d1.stretch.properties.approval})`);
ok((await admin.post(`/api/stretches/${sp1.id}/approve`)).status === 200, 'approved');
d1 = await admin.get(`/api/stretches/${sp1.id}`);
const rd = await admin.patch(`/api/stretches/${sp1.id}`, { base_version: d1.stretch.properties.version, geometry: one(free[1]), pipe_ids: [free[1].properties.id] });
d1 = await admin.get(`/api/stretches/${sp1.id}`);
ok(rd.status === 200 && d1.stretch.properties.approval === 'pending', `redrawn approved stretch needs approving again (${d1.stretch.properties.approval})`);
const staleR = await admin.patch(`/api/stretches/${sp1.id}`, { base_version: d1.stretch.properties.version - 1, changes: [{ path: 'restoration.stage', to: 'pending' }] });
await admin.post(`/api/stretches/${sp1.id}/approve`);
const staleA = await admin.patch(`/api/stretches/${sp1.id}`, { base_version: d1.stretch.properties.version, changes: [{ path: 'restoration.stage', to: 'pending' }] });
ok(staleA.status === 409, `a stale restoration edit after an approval is a conflict (${staleA.status}, earlier ${staleR.status})`);
// re-opened issue stays open after an unrelated edit
d1 = await admin.get(`/api/stretches/${sp1.id}`);
const ph5 = await admin.patch(`/api/stretches/${sp1.id}`, { base_version: d1.stretch.properties.version, changes: [{ path: 'hazards.potholes', to: 2 }] });
d1 = await admin.get(`/api/stretches/${sp1.id}`);
const pot = d1.issues.find((i) => i.kind === 'potholes' && i.status !== 'resolved');
await admin.patch(`/api/issues/${pot.id}`, { status: 'resolved', note: 'Filled' });
ok((await admin.patch(`/api/issues/${pot.id}`, { status: 'open', note: 'Sank again' })).status === 200, 'issue re-opened');
d1 = await admin.get(`/api/stretches/${sp1.id}`);
ok(d1.stretch.properties.status.hazards.potholes === 2, 'the potholes are back on the stretch');
await admin.patch(`/api/stretches/${sp1.id}`, { base_version: d1.stretch.properties.version, changes: [{ path: 'sewer.ics_built', to: 1 }] });
ok((await admin.get(`/api/issues/${pot.id}`)).issue.status === 'open', 'an unrelated edit does not close the re-opened issue');
// a rejected proposed stretch closes its issues
const prop = await aee.post('/api/stretches', { geometry: one(free[2]), pipe_ids: [free[2].properties.id], status: { utilities: { drain_clogged: true } } });
const pcr = (await admin.get('/api/change-requests?status=pending')).requests.find((r) => r.target_id === prop.id);
await admin.post(`/api/change-requests/${pcr.id}/reject`, { note: 'Not our road' });
const pis = (await admin.get('/api/issues')).issues.filter((i) => i.stretch_id === prop.id);
ok(pis.length >= 1 && pis.every((i) => i.status === 'resolved'), 'rejecting a proposed stretch closes its issues');
// pipes: no duplicates; pipe requests close with their rejected manhole; bulk checks photos
const dup = await aee.post('/api/change-requests', { entity: 'pipe', action: 'add', reason: 'dup', payload: { from: free[3].properties.from, to: free[3].properties.to, dia_mm: 150 } });
ok(dup.status === 409, `a second pipe between the same manholes is refused (${dup.status})`);
const mh2 = await aee.post('/api/change-requests', { entity: 'manhole', action: 'add', reason: 't', payload: { lon: midpoint(free[2].geometry)[0], lat: midpoint(free[2].geometry)[1], label: `8${String(stamp).slice(-3)}` } });
const pp2 = await aee.post('/api/change-requests', { entity: 'pipe', action: 'add', reason: 't', payload: { from: mh2.request.target_id, to: free[3].properties.from, dia_mm: 150 } });
await admin.post(`/api/change-requests/${mh2.request.id}/reject`, { note: 'No' });
const pp2s = (await admin.get('/api/change-requests?status=all')).requests.find((r) => r.id === pp2.request.id);
ok(pp2s.status === 'rejected', `the pipe request closes with its rejected manhole (${pp2s.status})`);
ok((await aee.post('/api/stretches/bulk', { ids: [sp1.id], changes: [{ path: 'motorable', to: 'yes' }], photos: ['00000000-0000-4000-8000-000000000000'] })).status === 400, 'bulk refuses a photo that does not exist');
// bad input gives 4xx, never 500
ok((await admin.get('/api/stretches/abc')).status === 404, 'non-id stretch is 404');
ok((await admin.post(`/api/stretches/${sp1.id}/revert`, {})).status === 400, 'revert without a version is 400');
ok((await admin.patch('/api/users/abc', { name: 'X Y' })).status === 404, 'non-id user is 404');
ok((await admin.get('/api/activity?limit=-5')).status === 200, 'negative activity limit is handled');
ok((await aee.post('/api/labour', { log_date: '2026-13-45', zone: 1, labourers: 1 })).status === 400, 'impossible date refused');
const tmr = new Date(Date.now() + 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
ok((await aee.post('/api/labour', { log_date: tmr, zone: 1, labourers: 1 })).status === 400, 'tomorrow refused for labour');
ok((await aee.post('/api/issues', { kind: 'other', location: loc, description: 'x', stretch_id: '00000000-0000-4000-8000-000000000000' })).status === 400, 'issue on a missing stretch is 400');
const enc = await fetch(base + '/%61pi/labour', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
ok(enc.status === 403, `encoded path still needs the app header (${enc.status})`);
// editing your own user keeps you signed in
const me = (await admin.get('/api/auth/me')).user;
ok((await admin.patch(`/api/users/${me.id}`, { name: me.name, role: 'admin' })).status === 200 && (await admin.get('/api/auth/me')).status === 200, 'editing your own entry keeps you signed in');

// ---- a save resent after a lost reply returns the first result (no duplicate)
const key = `test-${stamp}-issue`;
const idem = async () => (await aee.call('POST', '/api/issues', { kind: 'other', location: loc, description: 'Resent test' }, { headers: { 'x-idempotency-key': key } }));
const i1 = await idem();
const i2 = await idem();
ok(i1.status === 200 && i2.status === 200 && i1.id === i2.id, `resending with the same key gives the same issue (${i1.code} / ${i2.code})`);
const pk = `test-${stamp}-photo`;
const up = async () => { const jpg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64'); const fd = new FormData(); fd.append('file', new Blob([jpg], { type: 'image/jpeg' }), 'p.jpg'); return aee.call('POST', '/api/photos', fd, { headers: { 'x-idempotency-key': pk } }) };
const p1 = await up();
const p2 = await up();
ok(p1.id && p1.id === p2.id, 'resending a photo with the same key does not store it twice');
const otherUser = await admin.call('POST', '/api/issues', { kind: 'other', location: loc, description: 'Same key, other user' }, { headers: { 'x-idempotency-key': key } });
ok(otherUser.status === 200 && otherUser.id !== i1.id, 'keys are per user');

// ---- v1.2: labour per zone, 48-hour editing, supervisors
const { labourRights } = await import('../src/routes/labour.js');
const hoursAgo = (h) => new Date(Date.now() - h * 3600000).toISOString();
ok(!labourRights({ role: 'editor', id: 'a' }, { user_id: 'a', created_at: hoursAgo(49) }).edit, 'own entry frozen after 48 hours');
ok(labourRights({ role: 'editor', id: 'a' }, { user_id: 'a', created_at: hoursAgo(47) }).edit, 'own entry editable within 48 hours');
ok(!labourRights({ role: 'editor', id: 'a' }, { user_id: 'b', created_at: hoursAgo(1) }).edit, "field staff cannot edit someone else's entry");
ok(labourRights({ role: 'editor', id: 'a', supervisor: true }, { user_id: 'b', created_at: hoursAgo(1) }).edit, "supervisor (AEE) can edit others' entries within 48 hours");
ok(!labourRights({ role: 'editor', id: 'a', supervisor: true }, { user_id: 'b', created_at: hoursAgo(50) }).edit, 'supervisor cannot edit after 48 hours');
ok(labourRights({ role: 'admin', id: 'c' }, { user_id: 'b', created_at: hoursAgo(500) }).edit, 'Commissioner can always edit');
const mi = await admin.post('/api/users', { email: `test.insp.${stamp}@madhira.local`, name: 'Test Inspector', role: 'editor', wards: [9] });
const insp = client();
await signIn(insp, mi.user.email, mi.temp_password);
const L1 = await aee.post('/api/labour', { log_date: '2026-09-30', zone: 1, labourers: 20, machines: 1, note: 'Team A' });
ok(L1.status === 200 && L1.id, 'labour entry created');
const L1dup = await insp.post('/api/labour', { log_date: '2026-09-30', zone: 1, labourers: 5 });
ok(L1dup.status === 409 && L1dup.id === L1.id, 'second entry for the same zone and day points to the existing one');
ok((await aee.patch(`/api/labour/${L1.id}`, { labourers: 22 })).status === 200, 'owner corrects the entry');
ok((await insp.patch(`/api/labour/${L1.id}`, { labourers: 99 })).status === 403, "an inspector cannot change the AEE's entry");
const L2 = await insp.post('/api/labour', { log_date: '2026-09-29', zone: 1, labourers: 15 });
ok((await aee.patch(`/api/labour/${L2.id}`, { labourers: 16 })).status === 403, 'a non-supervisor editor cannot change others');
ok((await admin.patch(`/api/users/${mk.user.id}`, { supervisor: true })).status === 200, 'Commissioner makes the AEE a supervisor');
const aeeUser = (await admin.get('/api/users')).users.find((u) => u.id === mk.user.id);
ok(aeeUser.supervisor === true && aeeUser.wards.join() === '9,10,21,22', 'supervisor set, wards unchanged');
await new Promise((r) => setTimeout(r, 15500)); // the server caches users for 15 s
ok((await aee.patch(`/api/labour/${L2.id}`, { labourers: 17, note: 'corrected by AEE' })).status === 200, "the AEE (supervisor) corrects the inspector's entry");
const h = await admin.get(`/api/labour/${L2.id}`);
ok(h.events.length === 2 && h.events[0].action === 'edit' && h.entry.labourers === 17, `history kept (${h.events.length} events)`);
ok((await viewer.post('/api/labour', { log_date: '2026-09-28', zone: 1, labourers: 1 })).status === 403, 'viewer cannot log labour');
const list = await aee.get('/api/labour?zone=1&from=2026-09-01');
ok(list.entries.length >= 2 && list.entries.every((e) => e.zone === 1 && typeof e.editable === 'boolean'), 'labour list filters by zone and says what is editable');
const lx = await admin.call('GET', '/api/export/labour.xlsx?zone=1', undefined, { raw: true });
ok(lx.status === 200 && /spreadsheet/.test(lx.headers.get('content-type')), 'labour Excel downloads');
ok((await aee.del(`/api/labour/${L2.id}`)).status === 200, 'supervisor deletes an entry within 48 hours');
// resetting a password must not remove the wards (bug fixed in v1.2)
await admin.patch(`/api/users/${mi.user.id}`, { reset_password: true });
ok((await admin.get('/api/users')).users.find((u) => u.id === mi.user.id).wards.join() === '9', 'password reset keeps the wards');

// ---- v1.2: new issue kinds; Commissioner deletes issues for good
const cv = await aee.post('/api/issues', { kind: 'culvert_damage', location: loc, description: 'Culvert slab broken' });
const dd = await aee.post('/api/issues', { kind: 'drain_damage', location: loc, description: 'Drain wall cracked' });
ok(cv.status === 200 && dd.status === 200, 'culvert and drain damage can be reported');
ok((await admin.get(`/api/issues/${cv.id}`)).issue.severity === 'high', 'culvert damage is high severity');
ok((await aee.del(`/api/issues/${cv.id}`, { reason: 'x' })).status === 403, 'only the Commissioner deletes issues');
ok((await admin.del(`/api/issues/${cv.id}`, {})).status === 400, 'deleting needs a reason');
ok((await admin.del(`/api/issues/${cv.id}`, { reason: 'Duplicate report' })).status === 200, 'Commissioner deletes an issue');
ok((await admin.get(`/api/issues/${cv.id}`)).status === 404, 'the issue is gone');
const ds = await admin.post('/api/stretches', { geometry: one(free[4]), pipe_ids: [free[4].properties.id], status: { hazards: { potholes: 2 } } });
let dsd = await admin.get(`/api/stretches/${ds.id}`);
const potIssue = dsd.issues.find((i) => i.kind === 'potholes');
ok((await admin.del(`/api/issues/${potIssue.id}`, { reason: 'Recorded on the wrong road' })).status === 200, 'Commissioner deletes an issue raised from a road');
dsd = await admin.get(`/api/stretches/${ds.id}`);
ok(dsd.stretch.properties.status.hazards.potholes === 0 && dsd.versions[0].kind === 'issue_deleted', 'the damage is cleared on the road and recorded in its history');
await admin.patch(`/api/stretches/${ds.id}`, { base_version: dsd.stretch.properties.version, changes: [{ path: 'sewer.ics_built', to: 1 }] });
ok(!(await admin.get(`/api/stretches/${ds.id}`)).issues.length, 'the next save of the road does not raise it again');
const bulkDel = await admin.post('/api/issues/delete', { ids: [dd.id, ni.id], reason: 'Test clean-up' });
ok(bulkDel.status === 200 && bulkDel.deleted.length === 2, 'several issues deleted at once');

// ---- v1.25: road type (CC / gravel) and the field-only dashboard
const gr = await admin.post('/api/stretches', { name: 'Test gravel lane', geometry: one(free[5]), pipe_ids: [free[5].properties.id],
  status: { excavation: { stage: 'backfilled' }, sewer: { pipeline: 'laid' }, restoration: { surface: 'gravel', stage: 'pending' } } });
let gd = await admin.get(`/api/stretches/${gr.id}`);
ok(gr.status === 200 && gd.stretch.properties.status.restoration.surface === 'gravel', 'a gravel road is recorded');
const oldStyle = await admin.post('/api/stretches', { geometry: one(free[6]), pipe_ids: [free[6].properties.id], status: { restoration: { stage: 'pending' } } });
ok((await admin.get(`/api/stretches/${oldStyle.id}`)).stretch.properties.status.restoration.surface === 'cc', 'a road saved without a type (old phones, old records) is a CC road');
ok((await admin.patch(`/api/stretches/${gr.id}`, { base_version: gd.stretch.properties.version, changes: [{ path: 'restoration.surface', to: 'tar' }] })).status === 400, 'unknown road type refused');
ok((await admin.patch(`/api/stretches/${gr.id}`, { base_version: gd.stretch.properties.version, changes: [{ path: 'restoration.stage', to: 'restored_curing_pending' }] })).status === 400, 'gravel laid needs a photo');
const g1 = await admin.patch(`/api/stretches/${gr.id}`, { base_version: gd.stretch.properties.version, photos: [(await uploadPhoto(admin)).id], changes: [{ path: 'restoration.stage', to: 'restored_curing_pending' }] });
gd = await admin.get(`/api/stretches/${gr.id}`);
ok(g1.status === 200 && gd.stretch.properties.stage === 'curing', 'gravel laid, not compacted: stage "restored, curing / compaction"');
const g2 = await admin.patch(`/api/stretches/${gr.id}`, { base_version: g1.version, photos: [(await uploadPhoto(admin)).id], changes: [{ path: 'restoration.stage', to: 'restored_curing_done' }] });
gd = await admin.get(`/api/stretches/${gr.id}`);
ok(g2.status === 200 && gd.stretch.properties.approval === 'pending', 'gravel compacted goes for approval');
ok((await admin.post(`/api/stretches/${gr.id}/approve`)).status === 200, 'compacted gravel road approved');
gd = await admin.get(`/api/stretches/${gr.id}`);
ok(gd.stretch.properties.stage === 'approved', 'the gravel road turns green');
ok((await admin.patch(`/api/stretches/${gr.id}`, { base_version: gd.stretch.properties.version, changes: [{ path: 'restoration.surface', to: 'cc' }] })).status === 400, 'changing the type of a restored road needs a photo');
const g3 = await admin.patch(`/api/stretches/${gr.id}`, { base_version: gd.stretch.properties.version, photos: [(await uploadPhoto(admin)).id], changes: [{ path: 'restoration.surface', to: 'cc' }] });
gd = await admin.get(`/api/stretches/${gr.id}`);
ok(g3.status === 200 && gd.stretch.properties.approval === 'pending', 'a different road type needs approving again');
ok(gd.versions[0].status?.restoration?.surface === 'cc' && gd.versions.some((v) => v.changes.some((c) => c.path === 'restoration.surface')), 'history keeps the road type change with its snapshot');
await admin.patch(`/api/stretches/${gr.id}`, { base_version: gd.stretch.properties.version, photos: [(await uploadPhoto(admin)).id], changes: [{ path: 'restoration.surface', to: 'gravel' }] });
await admin.post(`/api/stretches/${gr.id}/approve`);
// stale edit of the road type while the step changed is a conflict
gd = await admin.get(`/api/stretches/${gr.id}`);
const gv = gd.stretch.properties.version;
await admin.patch(`/api/stretches/${gr.id}`, { base_version: gv, changes: [{ path: 'excavation.cut_length_m', to: 20 }] });
await admin.patch(`/api/stretches/${gr.id}`, { base_version: gv + 1, changes: [{ path: 'restoration.stage', to: 'pending' }] });
ok((await admin.patch(`/api/stretches/${gr.id}`, { base_version: gv, changes: [{ path: 'restoration.surface', to: 'cc' }] })).status === 409, 'road type and restoration step changed by two people: conflict');

const plan = await admin.get('/api/stats/plan');
ok(plan.status === 200 && Math.abs(plan.base.pipe_m - 119794.6) < 1, `plan network from the drawings: ${Math.round(plan.base.pipe_m)} m`);
ok(Math.abs(plan.current.pipe_m - (plan.base.pipe_m + plan.changes.added_pipe_m - plan.changes.removed_pipe_m)) < 1
  && plan.changes.added_pipes >= 1 && plan.changes.removed_pipes >= 1, `plan = drawings + approved additions − approved removals (${Math.round(plan.current.pipe_m)} m)`);
const tl2 = await admin.get('/api/stats/timeline');
const lastW = tl2.weeks.at(-1);
ok(Math.abs(lastW.plan_m - plan.current.pipe_m) < 1 && typeof lastW.issues_opened === 'number' && lastW.restored_gravel_m >= 0, 'weekly chart has the plan line and issues per week');
const wk = await admin.get('/api/stats/week');
ok(wk.status === 200 && wk.updates > 0 && wk.active.length > 0, `last 7 days: ${wk.updates} updates by ${wk.active.length} people`);
const { createRequire } = await import('node:module');
const ExcelJS = createRequire(path.join(root, 'server', 'package.json'))('exceljs');
const px = await admin.call('GET', '/api/export/progress.xlsx', undefined, { raw: true });
const wbk = new ExcelJS.Workbook();
await wbk.xlsx.load(Buffer.from(await px.arrayBuffer()));
const ph = wbk.getWorksheet('Progress');
const heads = [...ph.getRow(4).values, ...ph.getRow(5).values].filter(Boolean).join('|');
ok(/Plan network/.test(heads) && /Not yet recorded/.test(heads) && !/Sanctioned|reported/i.test(heads), 'Excel progress sheet is field-only (plan network, recorded, not yet recorded)');
ok(ph.rowCount > 22 + 4, `progress sheet has a row per ward (${ph.rowCount} rows)`);
const sh = wbk.getWorksheet('Stretches');
const typeCol = sh.getRow(1).values.indexOf('Road type');
let gravelRows = 0;
sh.eachRow((r, i) => { if (i > 1 && r.getCell(typeCol).value === 'Gravel road') gravelRows++ });
ok(typeCol > 0 && gravelRows >= 1, 'Stretches sheet shows the road type');
await admin.del(`/api/stretches/${gr.id}`, { reason: 'Test cleanup' });
await admin.del(`/api/stretches/${oldStyle.id}`, { reason: 'Test cleanup' });

// ---- clean up test users (deactivate)
await admin.patch(`/api/users/${mk.user.id}`, { active: false });
await admin.patch(`/api/users/${mv.user.id}`, { active: false });
ok((await aee.get('/api/stretches')).status === 401, 'deactivated user is signed out');

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);

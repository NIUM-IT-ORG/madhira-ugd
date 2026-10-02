/**
 * Read-only check after a deployment. Safe to run against the live system: it creates nothing.
 *   node server/test/postdeploy-check.mjs https://ugd.example.in [email password]
 * Without a login it checks that the site, the API and the sign-in guard respond. With a login (any
 * account) it also checks the map data, imagery tiles, network, dashboard figures and exports.
 */
const [base = 'http://localhost:8080', email, password] = process.argv.slice(2);
let failures = 0;
const ok = (cond, msg, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}${extra ? `  (${extra})` : ''}`);
  if (!cond) failures++;
};

async function get(path, cookie, headers = {}) {
  const res = await fetch(base + path, { headers: { ...(cookie ? { cookie } : {}), ...headers } });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, type: res.headers.get('content-type') ?? '', buf, json: () => JSON.parse(buf.toString()) };
}

const health = await get('/api/health').catch((e) => ({ status: 0, error: e.message }));
ok(health.status === 200, 'API health', health.status === 200 ? `database: ${health.json().db}` : health.error ?? health.status);
if (health.status !== 200) {
  console.log(`\nThe server at ${base} is not answering. Check that the app is running (docker compose ps / logs).`);
  process.exit(1);
}
const page = await get('/');
ok(page.status === 200 && page.type.includes('text/html'), 'web app is served');
ok((await get('/sw.js')).status === 200, 'phone app files are served');
ok((await get('/vendor/maplibre/maplibre-gl-worker.mjs')).status === 200, 'map engine worker is served');
ok((await get('/api/stretches')).status === 401, 'API refuses requests without sign-in');
ok((await get('/data/wards.geojson')).status === 401, 'map data refuses requests without sign-in');
if (base.startsWith('https://')) {
  const http = await fetch(base.replace('https://', 'http://'), { redirect: 'manual' }).catch(() => null);
  ok(!http || [301, 302, 307, 308].includes(http.status), 'plain http redirects to https');
}

if (email && password) {
  const r = await fetch(base + '/api/auth/login', {
    method: 'POST', headers: { 'x-ugd': '1', 'content-type': 'application/json' }, body: JSON.stringify({ email, password }),
  });
  ok(r.status === 200, 'sign-in works');
  const me = r.status === 200 ? await r.clone().json() : null;
  const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
  if (me?.user?.must_change_password) {
    console.log('NOTE  this account still has its one-time password, so the data checks are skipped.');
    console.log('      Sign in once in the browser and set a new password, then run this check again.');
    console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks so far passed');
    process.exit(failures ? 1 : 0);
  }
  if (base.startsWith('https://')) ok(/;\s*secure/i.test(r.headers.get('set-cookie') ?? ''), 'session cookie is marked Secure');
  const wards = await get('/data/wards.geojson', cookie);
  ok(wards.status === 200 && wards.json().features.length === 22, '22 wards');
  const net = await get('/api/network', cookie);
  const n = net.status === 200 ? net.json() : { pipes: { features: [] }, manholes: { features: [] } };
  ok(n.manholes.features.length >= 3900 && n.pipes.features.length >= 3900, 'sewer network loaded', `${n.manholes.features.length} manholes, ${n.pipes.features.length} pipes`);
  const imagery = (await get('/data/imagery.json', cookie)).json();
  ok(imagery.length === 4, '4 imagery frames listed');
  for (const f of imagery) {
    const t = await get(`/data/${f.file}`, cookie, { range: 'bytes=0-126' });
    ok(t.status === 206 && t.buf.subarray(0, 7).toString() === 'PMTiles', `imagery frame ${f.frame} tiles readable (range request)`);
  }
  const baseline = (await get('/data/baseline.json', cookie)).json();
  const sanc = baseline.groups.reduce((a, g) => a + g.sanctioned.pipe_m, 0);
  ok(sanc === 99560, 'progress sheet baseline', `${sanc} m sanctioned`);
  ok((await get('/api/stats/timeline', cookie)).status === 200, 'dashboard timeline');
  const x = await get('/api/export/progress.xlsx', cookie);
  ok(x.status === 200 && x.buf.subarray(0, 2).toString() === 'PK', 'Excel export');
  ok((await get('/api/export/stretches.kml', cookie)).status === 200, 'Google Earth (KML) export');
  const sse = await fetch(base + '/api/events', { headers: { cookie } });
  ok(sse.status === 200 && (sse.headers.get('content-type') ?? '').includes('event-stream'), 'live updates stream');
  await sse.body?.cancel();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);

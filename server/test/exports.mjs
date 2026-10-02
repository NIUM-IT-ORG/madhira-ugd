// Fetch each report endpoint as the admin and save the Excel file for inspection.
import fs from 'node:fs';
const base = process.argv[2] ?? 'http://localhost:8080';
const c = JSON.parse(fs.readFileSync('var/dev-credentials.json', 'utf8')).admin;
const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'x-ugd': '1', 'content-type': 'application/json' }, body: JSON.stringify({ email: c.email, password: c.password }) });
const cookie = r.headers.get('set-cookie').split(';')[0];
for (const u of ['/api/stats/timeline', '/api/export/progress.xlsx', '/api/export/stretches.kml', '/api/export/stretches.geojson']) {
  const x = await fetch(base + u, { headers: { cookie } });
  const b = Buffer.from(await x.arrayBuffer());
  console.log(u, x.status, x.headers.get('content-type'), b.length, u.endsWith('timeline') ? b.toString().slice(0, 240) : '');
  if (u.endsWith('.xlsx')) fs.writeFileSync('var/test-export.xlsx', b);
}

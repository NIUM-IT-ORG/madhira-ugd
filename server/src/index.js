import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import compress from '@fastify/compress';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import { openDb } from './db.js';
import { registerAuth } from './auth.js';
import { bootstrapAdmin } from './bootstrap.js';
import { registerEvents } from './events.js';
import { loadNetworkEdits } from './reference.js';
import { registerUserRoutes } from './routes/users.js';
import { registerStretchRoutes } from './routes/stretches.js';
import { registerIssueRoutes } from './routes/issues.js';
import { registerNetworkRoutes } from './routes/network.js';
import { registerMiscRoutes } from './routes/misc.js';
import { registerReportRoutes } from './routes/reports.js';
import { registerStorageRoutes } from './routes/storage.js';

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  trustProxy: true, // behind a load balancer / reverse proxy on the cloud host
  bodyLimit: 2 * 1024 * 1024,
  // Live-update streams stay open; close them on shutdown so restarts and redeploys are quick.
  forceCloseConnections: true,
});

const db = await openDb();
const edits = await loadNetworkEdits(db);
app.log.info(`database: ${db.engine}; network edits applied: ${edits}`);
await bootstrapAdmin(db, app.log);

// Compress JSON / GeoJSON only; map tiles are already compressed and are fetched with Range requests.
await app.register(compress, { customTypes: /json/, global: true, threshold: 1024 });
await app.register(cookie);
await app.register(multipart);
registerAuth(app, db);

// Reference map data (imagery, wards) is for signed-in users only.
app.addHook('onRequest', async (req, reply) => {
  if (!app.decodedPath(req).startsWith('/data/')) return;
  const u = await app.sessionUser(req);
  if (!u) return reply.code(401).send({ error: 'Please sign in.' });
  if (u.must_change_password) return reply.code(403).send({ error: 'Set your own password first.' });
});
await app.register(fastifyStatic, {
  root: config.dataDir,
  prefix: '/data/',
  decorateReply: false,
  acceptRanges: true,
  maxAge: '1h',
  // @fastify/static v10 passes the Fastify reply here.
  setHeaders(reply, file) {
    if (file.endsWith('.geojson')) reply.header('content-type', 'application/geo+json');
    if (file.endsWith('.pmtiles')) reply.header('content-type', 'application/octet-stream');
    reply.header('cache-control', 'private, max-age=3600');
  },
});

// Idempotent saves: a POST/PATCH carrying x-idempotency-key that was already answered gets the same answer
// again (a phone resending a save whose reply was lost must not create a duplicate).
await db.query("delete from request_keys where at < now() - interval '30 days'").catch(() => undefined);
app.addHook('preHandler', async (req, reply) => {
  const key = req.headers['x-idempotency-key'];
  if (!key || (req.method !== 'POST' && req.method !== 'PATCH') || !/^[\w:.-]{8,120}$/.test(key)) return;
  const u = await app.sessionUser(req);
  if (!u) return; // the route's own sign-in check answers
  const hit = (await db.query('select status, body from request_keys where key = $1 and user_id = $2', [key, u.id])).rows[0];
  if (hit) return reply.code(hit.status).header('content-type', 'application/json; charset=utf-8').header('x-idempotent-replay', '1').send(hit.body);
  req.idemKey = key;
  req.idemUser = u.id;
});
app.addHook('preSerialization', async (req, reply, payload) => {
  if (req.idemKey && reply.statusCode === 200) {
    await db.query('insert into request_keys (key, user_id, status, body) values ($1, $2, 200, $3) on conflict do nothing',
      [req.idemKey, req.idemUser, JSON.stringify(payload)]);
  }
  return payload;
});

app.get('/api/health', async () => ({ ok: true, db: db.engine, time: new Date().toISOString() }));
registerEvents(app);
registerUserRoutes(app, db);
registerStretchRoutes(app, db);
registerIssueRoutes(app, db);
registerNetworkRoutes(app, db);
registerMiscRoutes(app, db);
registerReportRoutes(app, db);
registerStorageRoutes(app, db);

// Bad input must never look like a server failure: map validation and database input errors to 4xx.
const PG_INPUT = {
  '22P02': [404, 'Not found.'], // invalid id (not a UUID) and similar text-to-type errors
  '22007': [400, 'Invalid date.'], '22008': [400, 'Invalid date.'],
  '23503': [400, 'Something this refers to does not exist (it may have been removed).'],
  '23505': [409, 'This already exists.'],
};
app.setErrorHandler((err, req, reply) => {
  if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
  if (err.name === 'ZodError' || Array.isArray(err.issues)) {
    return reply.code(400).send({ error: (err.issues ?? []).map((i) => i.message).join('; ') || 'Invalid request.' });
  }
  if (PG_INPUT[err.code]) {
    const [code, msg] = PG_INPUT[err.code];
    req.log.warn({ pg: err.code, detail: err.message }, 'rejected input');
    return reply.code(code).send({ error: err.code === '23505' && /email/.test(err.detail ?? err.message) ? 'Another user already has this email.' : msg });
  }
  req.log.error(err);
  return reply.code(500).send({ error: 'Something went wrong on the server. Please try again.' });
});

// The built web app, with client-side routing fallback to index.html.
if (fs.existsSync(path.join(config.webDir, 'index.html'))) {
  await app.register(fastifyStatic, { root: config.webDir, prefix: '/', decorateReply: true });
  app.setNotFoundHandler((req, reply) => {
    // Missing API paths and missing app files (e.g. an old build's /assets/… after an upgrade) are a real 404,
    // not the app page: a cached app must never store HTML as a script.
    if (/^\/(api|data|assets|vendor|glyphs)\//.test(req.raw.url)) {
      return reply.code(404).send({ error: 'Not found' });
    }
    return reply.sendFile('index.html');
  });
}

const shutdown = async () => {
  setTimeout(() => process.exit(0), 5000).unref();
  await app.close().catch(() => undefined);
  await db.close().catch(() => undefined);
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port: config.port, host: config.host });

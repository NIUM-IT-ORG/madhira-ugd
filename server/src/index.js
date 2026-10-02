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
  if (!req.url.startsWith('/data/')) return;
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

app.get('/api/health', async () => ({ ok: true, db: db.engine, time: new Date().toISOString() }));
registerEvents(app);
registerUserRoutes(app, db);
registerStretchRoutes(app, db);
registerIssueRoutes(app, db);
registerNetworkRoutes(app, db);
registerMiscRoutes(app, db);
registerReportRoutes(app, db);

app.setErrorHandler((err, req, reply) => {
  if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
  req.log.error(err);
  return reply.code(500).send({ error: 'Something went wrong on the server. Please try again.' });
});

// The built web app, with client-side routing fallback to index.html.
if (fs.existsSync(path.join(config.webDir, 'index.html'))) {
  await app.register(fastifyStatic, { root: config.webDir, prefix: '/', decorateReply: true });
  app.setNotFoundHandler((req, reply) => {
    if (req.raw.url.startsWith('/api/') || req.raw.url.startsWith('/data/')) {
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

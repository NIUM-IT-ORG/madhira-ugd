import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { canEditWard } from '../auth.js';
import { config } from '../config.js';
import { publish } from '../events.js';
import { reference } from '../reference.js';

const MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
// Real calendar days only (2026-13-45 is refused), compared as India-time dates.
const isDay = (s) => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
};
const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: process.env.TIME_ZONE ?? 'Asia/Kolkata' });
const numOrNull = (v) => (v === undefined || v === '' || v === null || Number.isNaN(Number(v)) ? null : Number(v));

export function registerMiscRoutes(app, db) {
  const auth = { preHandler: app.authenticate };

  // ---- photos: stored under UPLOAD_DIR/yyyy/mm/<uuid>.<ext>; served only to signed-in users.
  app.post('/api/photos', auth, async (req, reply) => {
    if (req.user.role === 'viewer') return reply.code(403).send({ error: 'Viewers cannot upload photos.' });
    const part = await req.file({ limits: { fileSize: config.maxPhotoBytes, files: 1 } });
    if (!part) return reply.code(400).send({ error: 'No photo received.' });
    const ext = MIME_EXT[part.mimetype];
    if (!ext) return reply.code(400).send({ error: 'Photos must be JPEG, PNG or WebP.' });
    const id = crypto.randomUUID();
    const now = new Date();
    const rel = path.join(String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, '0'), `${id}.${ext}`);
    const abs = path.join(config.uploadDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    await pipeline(part.file, fs.createWriteStream(abs));
    if (part.file.truncated) {
      fs.rmSync(abs, { force: true });
      return reply.code(413).send({ error: `Photo is larger than ${config.maxPhotoBytes / 1048576} MB.` });
    }
    const f = Object.fromEntries(Object.entries(part.fields).filter(([, v]) => v && v.type === 'field').map(([k, v]) => [k, v.value]));
    const takenAt = f.taken_at && !Number.isNaN(Date.parse(f.taken_at)) ? new Date(f.taken_at) : now;
    await db.query(
      'insert into photos (id, path, mime, bytes, lat, lng, accuracy, taken_at, uploaded_by) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [id, rel, part.mimetype, fs.statSync(abs).size, numOrNull(f.lat), numOrNull(f.lng), numOrNull(f.accuracy), takenAt, req.user.id],
    );
    return { id };
  });

  app.get('/api/photos/:id', auth, async (req, reply) => {
    if (!z.string().uuid().safeParse(req.params.id).success) return reply.code(404).send({ error: 'Not found.' });
    const p = (await db.query('select * from photos where id = $1', [req.params.id])).rows[0];
    if (!p) return reply.code(404).send({ error: 'Not found.' });
    const abs = path.join(config.uploadDir, p.path);
    if (!fs.existsSync(abs)) return reply.code(404).send({ error: 'Photo file missing.' });
    reply.header('content-type', p.mime).header('cache-control', 'private, max-age=31536000, immutable');
    return reply.send(fs.createReadStream(abs));
  });

  app.get('/api/photos/:id/meta', auth, async (req, reply) => {
    const p = (await db.query(
      'select p.id, p.lat, p.lng, p.accuracy, p.taken_at, p.uploaded_at, u.name as uploaded_by_name from photos p left join users u on u.id = p.uploaded_by where p.id = $1',
      [req.params.id],
    )).rows[0];
    return p ?? reply.code(404).send({ error: 'Not found.' });
  });

  // ---- activity feed: who changed what, newest first.
  app.get('/api/activity', auth, async (req) => {
    const limit = Math.max(1, Math.min(300, Math.floor(Number(req.query.limit)) || 80));
    const stretch = (await db.query(
      `select 'stretch' as entity, v.kind as action, v.at, v.changes, v.note, v.flagged_far, v.gps_distance_m, v.photos,
         s.id as entity_id, s.code, s.name, s.ward, u.name as user_name, u.designation as user_designation
       from stretch_versions v join stretches s on s.id = v.stretch_id left join users u on u.id = v.user_id
       order by v.at desc limit $1`, [limit],
    )).rows;
    const issue = (await db.query(
      `select 'issue' as entity, e.action, e.at, e.changes, e.note, false as flagged_far, null as gps_distance_m, '{}'::text[] as photos,
         i.id as entity_id, i.code, i.kind as name, i.ward, u.name as user_name, u.designation as user_designation
       from issue_events e join issues i on i.id = e.issue_id left join users u on u.id = e.user_id
       order by e.at desc limit $1`, [limit],
    )).rows;
    const cr = (await db.query(
      `select 'change_request' as entity, c.status as action, coalesce(c.decided_at, c.requested_at) as at, '[]'::jsonb as changes,
         coalesce(c.decision_note, c.reason) as note, false as flagged_far, null as gps_distance_m, '{}'::text[] as photos,
         c.id as entity_id, c.code, c.entity || ' ' || c.action as name, c.ward,
         coalesce(du.name, ru.name) as user_name, coalesce(du.designation, ru.designation) as user_designation
       from change_requests c left join users ru on ru.id = c.requested_by left join users du on du.id = c.decided_by
       order by coalesce(c.decided_at, c.requested_at) desc limit $1`, [limit],
    )).rows;
    const all = [...stretch, ...issue, ...cr].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, limit);
    return { activity: all };
  });
  // Labour: see labour.js.
}

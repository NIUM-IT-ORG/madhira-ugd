import { z } from 'zod';
import { ISSUE_KINDS } from '../../../shared/status.ts';
import { canEditWard } from '../auth.js';
import { nextCounter } from '../db.js';
import { publish } from '../events.js';
import { wardAt } from '../reference.js';
import { applyUpdate } from './stretches.js';

const KINDS = ISSUE_KINDS.map((k) => k.key);

const createBody = z.object({
  kind: z.enum(KINDS),
  location: z.tuple([z.number().min(80.2).max(80.55), z.number().min(16.8).max(17.05)]),
  stretch_id: z.string().uuid().optional().nullable(),
  count: z.number().int().min(1).max(1000).default(1),
  severity: z.enum(['low', 'medium', 'high']).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  photos: z.array(z.string().uuid()).min(1, 'Attach at least one photo.').max(10),
});
const patchBody = z.object({
  status: z.enum(['open', 'assigned', 'resolved']).optional(),
  assigned_to: z.string().trim().max(160).optional().nullable(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  severity: z.enum(['low', 'medium', 'high']).optional(),
  note: z.string().trim().max(2000).optional().nullable(),
  photos: z.array(z.string().uuid()).max(10).default([]),
});

/** Status change on the stretch that clears an issue raised from it. */
const CLEARS = {
  taps_broken: (s) => [{ path: 'utilities.taps_restored', to: s.utilities.taps_broken }],
  water_leak: () => [{ path: 'utilities.water_leaks', to: 0 }],
  drain_clogged: () => [{ path: 'utilities.drain_clogged', to: false }],
  water_stagnation: () => [{ path: 'hazards.water_stagnation', to: false }],
  potholes: () => [{ path: 'hazards.potholes', to: 0 }],
  uneven_backfill: () => [{ path: 'hazards.uneven_backfill', to: false }],
  not_motorable: () => [{ path: 'motorable', to: 'yes' }],
};

const SELECT = `
  select i.*, s.code as stretch_code, s.name as stretch_name, ru.name as reported_by_name, xu.name as resolved_by_name, uu.name as updated_by_name
  from issues i left join stretches s on s.id = i.stretch_id left join users ru on ru.id = i.reported_by
  left join users xu on xu.id = i.resolved_by left join users uu on uu.id = i.updated_by`;

export function registerIssueRoutes(app, db) {
  const auth = { preHandler: app.authenticate };

  app.get('/api/issues', auth, async () => ({ issues: (await db.query(`${SELECT} order by i.reported_at desc`)).rows }));

  app.get('/api/issues/:id', auth, async (req, reply) => {
    const issue = (await db.query(`${SELECT} where i.id = $1`, [req.params.id])).rows[0];
    if (!issue) return reply.code(404).send({ error: 'Issue not found.' });
    const events = (await db.query(
      'select e.*, u.name as user_name from issue_events e left join users u on u.id = e.user_id where e.issue_id = $1 order by e.at desc', [issue.id],
    )).rows;
    return { issue, events };
  });

  app.post('/api/issues', auth, async (req, reply) => {
    const body = createBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues.map((i) => i.message).join('; ') });
    const d = body.data;
    const { ward, zone } = wardAt(d.location);
    if (!canEditWard(req.user, ward)) return reply.code(403).send({ error: `Ward ${ward} is not assigned to you.` });
    const out = await db.tx(async (q) => {
      const n = (await q.query('select count(*)::int as n from photos where id = any($1::uuid[])', [d.photos])).rows[0].n;
      if (n !== d.photos.length) throw { code: 400, body: { error: 'A photo could not be found; upload it again.' } };
      const seq = await nextCounter(q, 'issue');
      const code = `I-${String(seq).padStart(4, '0')}`;
      const severity = d.severity ?? ISSUE_KINDS.find((k) => k.key === d.kind)?.severity ?? 'medium';
      const r = await q.query(
        `insert into issues (code, kind, stretch_id, ward, zone, location, count, severity, description, photos, source, reported_by, updated_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'manual', $11, $11) returning id`,
        [code, d.kind, d.stretch_id ?? null, ward, zone, JSON.stringify(d.location), d.count, severity, d.description ?? null, d.photos, req.user.id],
      );
      await q.query("insert into issue_events (issue_id, user_id, action, note) values ($1, $2, 'open', $3)", [r.rows[0].id, req.user.id, d.description ?? null]);
      if (d.stretch_id) {
        await q.query("update stretches set open_issues = (select count(*) from issues where stretch_id = $1 and status <> 'resolved') where id = $1", [d.stretch_id]);
      }
      return { id: r.rows[0].id, code };
    }).catch((e) => (e?.code && e?.body ? e : Promise.reject(e)));
    if (out.body) return reply.code(out.code).send(out.body);
    publish({ entity: 'issue', id: out.id, action: 'create', by: req.user.name });
    return out;
  });

  app.patch('/api/issues/:id', auth, async (req, reply) => {
    const body = patchBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues.map((i) => i.message).join('; ') });
    const d = body.data;
    try {
      const out = await db.tx(async (q) => {
        const i = (await q.query('select * from issues where id = $1 for update', [req.params.id])).rows[0];
        if (!i) throw { code: 404, body: { error: 'Issue not found.' } };
        if (!canEditWard(req.user, i.ward)) throw { code: 403, body: { error: `Ward ${i.ward} is not assigned to you.` } };
        if (i.status === 'resolved' && d.status !== 'open') throw { code: 400, body: { error: 'This issue is resolved. Re-open it to change it.' } };
        if (d.status === 'resolved' && !d.note) throw { code: 400, body: { error: 'Say how the issue was resolved.' } };
        const changes = [];
        const sets = ['updated_by = $1', 'updated_at = now()'];
        const vals = [req.user.id];
        for (const k of ['status', 'assigned_to', 'due_date', 'severity']) {
          if (d[k] !== undefined && String(d[k] ?? '') !== String(i[k] instanceof Date ? i[k].toISOString().slice(0, 10) : i[k] ?? '')) {
            vals.push(d[k]);
            sets.push(`${k} = $${vals.length}`);
            changes.push({ path: k, from: i[k], to: d[k] });
          }
        }
        if (d.status === 'resolved') {
          vals.push(d.note);
          sets.push(`resolved_by = $1, resolved_at = now(), resolution_note = $${vals.length}`);
        }
        if (d.status === 'open' && i.status === 'resolved') sets.push('resolved_by = null, resolved_at = null, resolution_note = null');
        if (d.photos.length) {
          vals.push(d.photos);
          sets.push(`photos = photos || $${vals.length}::text[]`);
        }
        if (!changes.length && !d.note && !d.photos.length) throw { code: 400, body: { error: 'Nothing changed.' } };
        vals.push(i.id);
        await q.query(`update issues set ${sets.join(', ')} where id = $${vals.length}`, vals);
        await q.query('insert into issue_events (issue_id, user_id, action, changes, note) values ($1, $2, $3, $4, $5)',
          [i.id, req.user.id, d.status === 'resolved' ? 'resolve' : d.status === 'open' && i.status === 'resolved' ? 'reopen' : 'update', JSON.stringify(changes), d.note ?? null]);

        // Resolving an issue raised from a stretch also clears it on the stretch, so the two never disagree.
        if (d.status === 'resolved' && i.source === 'stretch' && i.stretch_id && CLEARS[i.kind]) {
          const s = (await q.query('select * from stretches where id = $1 and deleted_at is null for update', [i.stretch_id])).rows[0];
          if (s) {
            await applyUpdate(q, { ...req.user, role: 'admin' }, s, {
              changes: CLEARS[i.kind](s.status), photos: d.photos, note: `Issue ${i.code} resolved: ${d.note}`, kind: 'issue_resolved',
            }).catch((e) => {
              if (!(e?.body?.error === 'Nothing changed.')) throw e;
            });
          }
        }
        if (i.stretch_id) {
          await q.query("update stretches set open_issues = (select count(*) from issues where stretch_id = $1 and status <> 'resolved') where id = $1", [i.stretch_id]);
        }
        return { id: i.id, stretch_id: i.stretch_id };
      });
      publish({ entity: 'issue', id: out.id, action: 'update', by: req.user.name });
      if (out.stretch_id) publish({ entity: 'stretch', id: out.stretch_id, action: 'update', by: req.user.name });
      return { ok: true };
    } catch (e) {
      if (e?.code && e?.body) return reply.code(e.code).send(e.body);
      throw e;
    }
  });
}

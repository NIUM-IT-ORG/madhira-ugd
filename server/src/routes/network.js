import { z } from 'zod';
import { distanceM } from '../../../shared/geo.ts';
import { canEditWard } from '../auth.js';
import { nextCounter } from '../db.js';
import { publish } from '../events.js';
import { applyNetworkEdit, network, networkCollections, pipesAtManhole, wardAt } from '../reference.js';
import { softDeleteStretch } from './stretches.js';

/*
 * Change requests: AEEs propose adding or deleting road stretches, pipes and manholes; the Commissioner
 * approves or rejects. Requests made by the Commissioner are approved at once. Nothing is removed from
 * the history: an approved deletion hides the feature, and every decision is recorded.
 */

const num = z.number().finite();
const manholeAdd = z.object({
  lon: num.min(80.2).max(80.55),
  lat: num.min(16.8).max(17.05),
  label: z.string().trim().regex(/^(MH-?)?\d{1,5}(\/\w{1,3})?$/i, 'Use a manhole number like MH-2301 or 2301/1'),
  gl: num.min(30).max(100).nullable().optional(),
  il: num.min(20).max(100).nullable().optional(),
});
const pipeAdd = z.object({
  from: z.string().min(3).max(60),
  to: z.string().min(3).max(60),
  dia_mm: z.number().int().refine((d) => [110, 150, 160, 200, 225, 250, 300, 350, 400, 450, 500, 600, 700, 800].includes(d), 'Choose a standard diameter'),
  slope: z.string().trim().regex(/^1\/\d{2,5}$/, 'Write slope as 1/150').nullable().optional(),
  length_m: num.positive().max(500).nullable().optional(),
});
const requestBody = z.object({
  entity: z.enum(['stretch', 'pipe', 'manhole']),
  action: z.enum(['add', 'delete']),
  target_id: z.string().max(80).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  reason: z.string().trim().max(2000).optional().nullable(),
});

const normLabel = (l) => {
  const m = /^(?:MH-?)?(.+)$/i.exec(l.trim());
  return `MH-${m[1]}`;
};

/** Manholes that will exist once pending requests are approved (for linking new pipes). */
async function pendingManholes(q) {
  const rows = (await q.query("select target_id, payload from change_requests where entity = 'manhole' and action = 'add' and status = 'pending'")).rows;
  return new Map(rows.map((r) => [r.target_id, r.payload]));
}

function manholeCoord(id, pending) {
  const f = network.manholes.get(id);
  if (f) return { coord: f.geometry.coordinates, il: f.properties.il, label: f.properties.label, zone: f.properties.zone };
  const p = pending.get(id);
  if (p) return { coord: p.geometry.coordinates, il: p.properties.il, label: p.properties.label, zone: p.properties.zone, pending: true };
  return null;
}

async function buildRequest(q, user, body) {
  const { entity, action } = body;
  if (entity === 'manhole' && action === 'add') {
    const d = manholeAdd.parse(body.payload ?? {});
    const { ward, zone, inside } = wardAt([d.lon, d.lat]);
    const label = normLabel(d.label);
    const id = `Z${zone}/${label}`;
    const pending = await pendingManholes(q);
    if (network.manholes.has(id) || pending.has(id)) throw { code: 409, body: { error: `${label} already exists in Zone ${zone}. Use a new number.` } };
    return {
      target_id: id, ward, zone,
      payload: {
        geometry: { type: 'Point', coordinates: [d.lon, d.lat] },
        properties: { id, zone, ward, label, gl: d.gl ?? null, il: d.il ?? null, sheets: ['field'], outside_boundary: !inside },
      },
    };
  }
  if (entity === 'pipe' && action === 'add') {
    const d = pipeAdd.parse(body.payload ?? {});
    if (d.from === d.to) throw { code: 400, body: { error: 'A pipe must join two different manholes.' } };
    const pending = await pendingManholes(q);
    const a = manholeCoord(d.from, pending);
    const b = manholeCoord(d.to, pending);
    if (!a || !b) throw { code: 400, body: { error: 'Both manholes must exist on the map or be proposed first.' } };
    // One pipe between two manholes: refuse a second one (also a double tap on Send).
    const joins = (p) => (p.from === d.from && p.to === d.to) || (p.from === d.to && p.to === d.from);
    const existing = [...network.pipes.values()].find((f) => joins(f.properties));
    if (existing) throw { code: 409, body: { error: `Pipe ${existing.properties.id} already joins these manholes.` } };
    const twin = (await q.query("select code, payload from change_requests where entity = 'pipe' and action = 'add' and status = 'pending'")).rows
      .find((r) => joins(r.payload?.properties ?? {}));
    if (twin) throw { code: 409, body: { error: `Request ${twin.code} for a pipe between these manholes is already waiting.` } };
    const geomLen = distanceM(a.coord, b.coord);
    if (geomLen > 500) throw { code: 400, body: { error: `The manholes are ${Math.round(geomLen)} m apart; pipes between manholes are normally under 100 m.` } };
    const mid = [(a.coord[0] + b.coord[0]) / 2, (a.coord[1] + b.coord[1]) / 2];
    const { ward, zone } = wardAt(mid);
    // Flow runs from the higher invert level to the lower one.
    const [up, dn, upI, dnI] = a.il != null && b.il != null && b.il > a.il ? [d.to, d.from, b, a] : [d.from, d.to, a, b];
    const seq = await nextCounter(q, `pipe-field-z${zone}`);
    const id = `P${zone}-F${String(seq).padStart(4, '0')}`;
    return {
      target_id: id, ward, zone,
      payload: {
        geometry: { type: 'LineString', coordinates: [upI.coord, dnI.coord] },
        properties: {
          id, zone, ward, from: up, to: dn, from_label: upI.label, to_label: dnI.label,
          length_m: d.length_m ?? Math.round(geomLen * 10) / 10, len_label_m: d.length_m ?? null, len_geom_m: Math.round(geomLen * 10) / 10,
          dia_mm: d.dia_mm, slope: d.slope ?? null, source: 'field', sheet: 'field',
        },
      },
    };
  }
  if (action === 'delete') {
    const id = z.string().min(1).parse(body.target_id);
    if (entity === 'pipe') {
      const f = network.pipes.get(id);
      if (!f) throw { code: 404, body: { error: 'Pipe not found.' } };
      return { target_id: id, ward: f.properties.ward, zone: f.properties.zone, payload: { label: `${f.properties.from_label ?? f.properties.from} → ${f.properties.to_label ?? f.properties.to}` } };
    }
    if (entity === 'manhole') {
      const f = network.manholes.get(id);
      if (!f) throw { code: 404, body: { error: 'Manhole not found.' } };
      return { target_id: id, ward: f.properties.ward, zone: f.properties.zone, payload: { label: f.properties.label, cascade_pipes: pipesAtManhole(id) } };
    }
    const s = (await q.query("select * from stretches where id = $1 and deleted_at is null and record_state <> 'rejected'", [id])).rows[0];
    if (!s) throw { code: 404, body: { error: 'Stretch not found.' } };
    return { target_id: id, ward: s.ward, zone: s.zone, payload: { label: s.code, name: s.name } };
  }
  throw { code: 400, body: { error: 'Road stretches are added by drawing them on the map.' } };
}

/** Carry out an approved request. Returns network edits to apply in memory after the transaction commits. */
async function execute(q, user, cr) {
  const edits = [];
  const addEdit = async (kind, feature_id, op, geometry, properties) => {
    await q.query(
      'insert into network_edits (kind, feature_id, op, geometry, properties, change_request_id, user_id) values ($1, $2, $3, $4, $5, $6, $7)',
      [kind, feature_id, op, geometry ?? null, properties ?? null, cr.id, user.id],
    );
    edits.push({ kind, feature_id, op, geometry, properties });
  };
  if (cr.entity === 'stretch') {
    const s = (await q.query('select * from stretches where id = $1 for update', [cr.target_id])).rows[0];
    if (!s || s.deleted_at) throw { code: 404, body: { error: 'Stretch not found.' } };
    if (cr.action === 'add') {
      await q.query("update stretches set record_state = 'active', updated_at = now() where id = $1", [s.id]);
    } else {
      await softDeleteStretch(q, user.id, s, `Removed: request ${cr.code} approved.`);
    }
  } else if (cr.action === 'add') {
    let { geometry, properties } = cr.payload;
    if (cr.entity === 'manhole' && network.manholes.has(cr.target_id)) {
      throw { code: 409, body: { error: `${properties.label} already exists in Zone ${properties.zone}. Reject this request.` } };
    }
    if (cr.entity === 'pipe') {
      const ends = [properties.from, properties.to];
      for (const end of ends) {
        if (network.manholes.has(end)) continue;
        const waiting = (await q.query("select code from change_requests where entity = 'manhole' and action = 'add' and target_id = $1 and status = 'pending'", [end])).rows[0];
        throw { code: 400, body: { error: waiting ? `Approve request ${waiting.code}, which adds manhole ${end.split('/')[1]}, first.` : `Manhole ${end.split('/')[1]} is not on the map (it was rejected or removed). Reject this request.` } };
      }
      const joins = (p) => (p.from === ends[0] && p.to === ends[1]) || (p.from === ends[1] && p.to === ends[0]);
      const dupe = [...network.pipes.values()].find((f) => joins(f.properties));
      if (dupe) throw { code: 409, body: { error: `Pipe ${dupe.properties.id} already joins these manholes. Reject this request.` } };
      // Draw the pipe between the manholes as they are now: a proposed manhole may have been re-proposed elsewhere.
      const [ca, cb] = ends.map((e) => network.manholes.get(e).geometry.coordinates);
      const moved = Math.max(distanceM(ca, geometry.coordinates[0]), distanceM(cb, geometry.coordinates[1]));
      if (moved > 5) throw { code: 409, body: { error: `A manhole of this pipe is now ${Math.round(moved)} m from where it was when the pipe was proposed. Reject this request and propose the pipe again.` } };
      const len = Math.round(distanceM(ca, cb) * 10) / 10;
      geometry = { type: 'LineString', coordinates: [ca, cb] };
      properties = { ...properties, len_geom_m: len, length_m: properties.len_label_m ?? len };
    }
    await addEdit(cr.entity, cr.target_id, 'add', geometry, properties);
  } else {
    const map = cr.entity === 'pipe' ? network.pipes : network.manholes;
    if (!map.has(cr.target_id)) throw { code: 409, body: { error: 'This feature has already been removed.' } };
    if (cr.entity === 'manhole') for (const p of pipesAtManhole(cr.target_id)) await addEdit('pipe', p, 'delete');
    await addEdit(cr.entity, cr.target_id, 'delete');
  }
  return edits;
}

const listSql = `
  select c.*, ru.name as requested_by_name, ru.designation as requested_by_designation, du.name as decided_by_name
  from change_requests c left join users ru on ru.id = c.requested_by left join users du on du.id = c.decided_by`;

export async function createChangeRequest(q, user, body) {
  // One request at a time, so two at once (a double tap, two phones) cannot both pass the duplicate checks.
  await q.query("select pg_advisory_xact_lock(hashtext('change_requests'))");
  const built = await buildRequest(q, user, body);
  if (!canEditWard(user, built.ward)) throw { code: 403, body: { error: `Ward ${built.ward} is not assigned to you.` } };
  const dup = (await q.query(
    "select code from change_requests where entity = $1 and action = $2 and target_id = $3 and status = 'pending'",
    [body.entity, body.action, built.target_id],
  )).rows[0];
  if (dup) throw { code: 409, body: { error: `Request ${dup.code} for this is already waiting for approval.` } };
  const seq = await nextCounter(q, 'change-request');
  const r = await q.query(
    `insert into change_requests (code, entity, action, target_id, payload, reason, ward, zone, requested_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`,
    [`CR-${String(seq).padStart(4, '0')}`, body.entity, body.action, built.target_id, built.payload ?? null, body.reason ?? null, built.ward, built.zone, user.id],
  );
  return r.rows[0];
}

/** A proposed stretch that will not be added (rejected or withdrawn): hidden, its issues closed, out of the figures. */
async function dropProposedStretch(q, user, cr, why) {
  const s = (await q.query('select * from stretches where id = $1 and deleted_at is null for update', [cr.target_id])).rows[0];
  await q.query("update stretches set record_state = 'rejected', updated_at = now() where id = $1", [cr.target_id]);
  if (s) await softDeleteStretch(q, user.id, s, why);
}

/** Pipe proposals that depend on a manhole proposal that will not happen are closed with it. */
async function closeDependentPipes(q, user, cr, status) {
  if (cr.entity !== 'manhole' || cr.action !== 'add') return;
  await q.query(
    `update change_requests set status = $1, decided_by = $2, decided_at = now(), decision_note = $3
     where entity = 'pipe' and action = 'add' and status = 'pending'
       and (payload->'properties'->>'from' = $4 or payload->'properties'->>'to' = $4)`,
    [status === 'withdrawn' ? 'withdrawn' : 'rejected', user.id, `Manhole ${cr.payload?.properties?.label ?? cr.target_id} was ${status}.`, cr.target_id],
  );
}

async function decide(q, user, cr, to, note) {
  let edits = [];
  if (to === 'approved') edits = await execute(q, user, cr);
  if (to === 'rejected' && cr.entity === 'stretch' && cr.action === 'add') await dropProposedStretch(q, user, cr, `Not added: request ${cr.code} rejected.`);
  if (to === 'rejected') await closeDependentPipes(q, user, cr, 'rejected');
  await q.query('update change_requests set status = $1, decided_by = $2, decided_at = now(), decision_note = $3 where id = $4', [to, user.id, note ?? null, cr.id]);
  return edits;
}

const sendError = (reply, e) => {
  if (e?.code && e?.body) return reply.code(e.code).send(e.body);
  if (e instanceof z.ZodError) return reply.code(400).send({ error: e.issues.map((i) => i.message).join('; ') });
  throw e;
};

export function registerNetworkRoutes(app, db) {
  const auth = { preHandler: app.authenticate };
  const admin = { preHandler: app.requireRole('admin') };

  app.get('/api/network', auth, async (req, reply) => {
    reply.header('etag', `"net-${network.revision}"`);
    if (req.headers['if-none-match'] === `"net-${network.revision}"`) return reply.code(304).send();
    return networkCollections();
  });

  app.get('/api/change-requests', auth, async (req) => {
    const status = z.enum(['pending', 'approved', 'rejected', 'withdrawn', 'all']).catch('all').parse(req.query.status);
    const rows = (await db.query(`${listSql} ${status === 'all' ? '' : 'where c.status = $1'} order by c.requested_at desc limit 500`, status === 'all' ? [] : [status])).rows;
    return { requests: rows };
  });

  app.post('/api/change-requests', auth, async (req, reply) => {
    if (req.user.role === 'viewer') return reply.code(403).send({ error: 'Viewers cannot propose changes.' });
    const body = requestBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Invalid request.' });
    if (body.data.action === 'delete' && req.user.role !== 'admin' && !body.data.reason) {
      return reply.code(400).send({ error: 'Give a reason for the deletion.' });
    }
    try {
      let edits = [];
      const cr = await db.tx(async (q) => {
        const made = await createChangeRequest(q, req.user, body.data);
        // The Commissioner's own changes need no second approval.
        if (req.user.role === 'admin') edits = await decide(q, req.user, made, 'approved', 'Made by the Commissioner.');
        return made;
      });
      for (const e of edits) applyNetworkEdit(e);
      publish({ entity: 'change_request', id: cr.id, action: req.user.role === 'admin' ? 'approve' : 'create', by: req.user.name });
      if (edits.length) publish({ entity: 'network', action: 'update' });
      if (cr.entity === 'stretch' && req.user.role === 'admin') publish({ entity: 'stretch', id: cr.target_id, action: 'delete' });
      return { request: { ...cr, status: req.user.role === 'admin' ? 'approved' : 'pending' } };
    } catch (e) {
      return sendError(reply, e);
    }
  });

  async function act(req, reply, to) {
    const parsed = z.object({ note: z.string().trim().max(2000).optional().nullable() }).safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'The note must be text of at most 2,000 characters.' });
    const note = parsed.data.note;
    if (to === 'rejected' && !note) return reply.code(400).send({ error: 'Give a reason for rejecting.' });
    if (!z.string().uuid().safeParse(req.params.id).success) return reply.code(404).send({ error: 'Request not found.' });
    try {
      let edits = [];
      const cr = await db.tx(async (q) => {
        const c = (await q.query('select * from change_requests where id = $1 for update', [req.params.id])).rows[0];
        if (!c) throw { code: 404, body: { error: 'Request not found.' } };
        if (c.status !== 'pending') throw { code: 400, body: { error: `This request is already ${c.status}.` } };
        if (to === 'withdrawn') {
          if (c.requested_by !== req.user.id && req.user.role !== 'admin') throw { code: 403, body: { error: 'Only the person who asked can withdraw it.' } };
          if (c.entity === 'stretch' && c.action === 'add') await dropProposedStretch(q, req.user, c, `Not added: request ${c.code} withdrawn.`);
          await closeDependentPipes(q, req.user, c, 'withdrawn');
          await q.query("update change_requests set status = 'withdrawn', decided_by = $1, decided_at = now(), decision_note = $2 where id = $3", [req.user.id, note ?? null, c.id]);
        } else {
          edits = await decide(q, req.user, c, to, note);
        }
        return c;
      });
      for (const e of edits) applyNetworkEdit(e);
      publish({ entity: 'change_request', id: cr.id, action: to, by: req.user.name });
      if (edits.length) publish({ entity: 'network', action: 'update' });
      if (cr.entity === 'stretch') publish({ entity: 'stretch', id: cr.target_id, action: to });
      return { ok: true };
    } catch (e) {
      return sendError(reply, e);
    }
  }
  app.post('/api/change-requests/:id/approve', admin, (req, reply) => act(req, reply, 'approved'));
  app.post('/api/change-requests/:id/reject', admin, (req, reply) => act(req, reply, 'rejected'));
  app.post('/api/change-requests/:id/withdraw', auth, (req, reply) => act(req, reply, 'withdrawn'));
}

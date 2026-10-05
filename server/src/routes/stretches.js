import crypto from 'node:crypto';
import { z } from 'zod';
import {
  applyChanges, checkStatus, defaultStatus, deriveStage, diffStatus, impliedIssues, ISSUE_KINDS, nextApproval, normaliseStatus,
} from '../../../shared/status.ts';
import { distanceToLineM, lengthM, midpoint } from '../../../shared/geo.ts';
import { canEditWard } from '../auth.js';
import { nextCounter } from '../db.js';
import { publish } from '../events.js';
import { knownPipes, plannedManholes, wardOfGeometry } from '../reference.js';
import { audit } from './users.js';

// ------------------------------------------------------------------ request schemas

const lonLat = z.tuple([z.number().min(80.2).max(80.55), z.number().min(16.8).max(17.05)]);
const line = z.array(lonLat).min(2).max(2000);
const geometry = z.discriminatedUnion('type', [
  z.object({ type: z.literal('LineString'), coordinates: line }),
  z.object({ type: z.literal('MultiLineString'), coordinates: z.array(line).min(1).max(200) }),
]);
const gps = z.object({ lat: z.number(), lng: z.number(), accuracy: z.number().nullable().optional() }).nullable().optional();
const change = z.object({ path: z.string().regex(/^[a-z_]+(\.[a-z_]+)?$/), to: z.union([z.string(), z.number(), z.boolean(), z.null()]) });
const photoIds = z.array(z.string().uuid()).max(10).default([]);

const createBody = z.object({
  name: z.string().trim().max(160).optional().nullable(),
  geometry,
  pipe_ids: z.array(z.string().max(20)).max(500).default([]),
  status: z.record(z.string(), z.unknown()).optional(),
  note: z.string().trim().max(2000).optional().nullable(),
  photos: photoIds,
  gps,
});
const updateBody = z.object({
  base_version: z.number().int().positive(),
  changes: z.array(change).max(40).default([]),
  name: z.string().trim().max(160).optional().nullable(),
  geometry: geometry.optional(),
  pipe_ids: z.array(z.string().max(20)).max(500).optional(),
  note: z.string().trim().max(2000).optional().nullable(),
  photos: photoIds,
  gps,
});
const bulkBody = z.object({
  ids: z.array(z.string().uuid()).min(1).max(300),
  changes: z.array(change).min(1).max(40),
  note: z.string().trim().max(2000).optional().nullable(),
  photos: photoIds,
  gps,
});

const STATUS_PATHS = new Set([
  'sewer.pipeline', 'sewer.pipe_laid_m', 'sewer.manholes_built', 'sewer.ics_built', 'excavation.stage', 'excavation.cut_length_m',
  'restoration.stage', 'motorable', 'utilities.taps_broken', 'utilities.taps_restored', 'utilities.water_leaks', 'utilities.water_leaks_fixed',
  'utilities.drain_clogged', 'hazards.water_stagnation', 'hazards.potholes', 'hazards.uneven_backfill',
]);
const ENUMS = {
  'sewer.pipeline': ['not_started', 'partial', 'laid'],
  'excavation.stage': ['none', 'road_cut', 'trench_open', 'backfilled'],
  'restoration.stage': ['not_due', 'pending', 'restored_curing_pending', 'restored_curing_done'],
  motorable: ['yes', 'difficult', 'no'],
};
const LINKED_PATHS = [['utilities.taps_broken', 'utilities.taps_restored'], ['utilities.water_leaks', 'utilities.water_leaks_fixed']];
const BOOLS = new Set(['utilities.drain_clogged', 'hazards.water_stagnation', 'hazards.uneven_backfill']);
const NULLABLE = new Set(['sewer.pipe_laid_m', 'excavation.cut_length_m']);

/** Reject unknown fields and wrong types before they reach the status. */
function changeProblems(changes) {
  const out = [];
  for (const c of changes) {
    if (!STATUS_PATHS.has(c.path)) out.push(`Unknown field ${c.path}.`);
    else if (ENUMS[c.path] && !ENUMS[c.path].includes(c.to)) out.push(`Invalid value for ${c.path}.`);
    else if (BOOLS.has(c.path) && typeof c.to !== 'boolean') out.push(`${c.path} must be yes or no.`);
    else if (!ENUMS[c.path] && !BOOLS.has(c.path) && !(typeof c.to === 'number' || (c.to === null && NULLABLE.has(c.path)))) {
      out.push(`${c.path} must be a number.`);
    }
  }
  return out;
}

function statusToChanges(partial) {
  const s = normaliseStatus(partial);
  return diffStatus(defaultStatus(), s).map((c) => ({ path: c.path, to: c.to }));
}

// ------------------------------------------------------------------ helpers

function rowToFeature(r) {
  return {
    type: 'Feature',
    id: r.id,
    geometry: r.geometry,
    properties: {
      id: r.id, code: r.code, name: r.name, ward: r.ward, zone: r.zone, length_m: r.length_m, planned_mh: r.planned_mh,
      pipe_ids: r.pipe_ids, status: normaliseStatus(r.status), approval: r.approval, stage: r.stage, open_issues: r.open_issues,
      version: r.version, record_state: r.record_state, created_at: r.created_at, updated_at: r.updated_at, updated_by: r.updated_by,
      updated_by_name: r.updated_by_name ?? null, flagged_far: r.flagged_far ?? false, approved_at: r.approved_at,
      outside_ward: !wardOfGeometry(r.geometry).inside,
    },
  };
}

const SELECT_STRETCH = `
  select s.*, u.name as updated_by_name,
    (select v.flagged_far from stretch_versions v where v.stretch_id = s.id order by v.version desc limit 1) as flagged_far
  from stretches s left join users u on u.id = s.updated_by`;

function gpsCheck(g, geom) {
  if (!g) return { distance: null, far: false };
  const d = distanceToLineM([g.lng, g.lat], geom);
  return { distance: Math.round(d), far: d > (Number(process.env.FAR_THRESHOLD_M ?? 200)) };
}

async function photosExist(q, ids) {
  if (!ids.length) return true;
  const r = await q.query('select count(*)::int as n from photos where id = any($1::uuid[])', [ids]);
  return r.rows[0].n === ids.length;
}

/**
 * Keep the issues table in step with a stretch's utilities / hazards: open an issue when an item is
 * first reported, update its count, resolve it when the item is cleared. Returns open issues on the stretch.
 */
export async function syncIssues(q, stretch, status, userId, photos, version) {
  const implied = impliedIssues(status);
  const open = (await q.query(
    "select * from issues where stretch_id = $1 and source = 'stretch' and status <> 'resolved'", [stretch.id],
  )).rows;
  const byKind = new Map(open.map((i) => [i.kind, i]));
  const mid = midpoint(stretch.geometry);
  for (const [kind, n] of Object.entries(implied)) {
    const ex = byKind.get(kind);
    if (n > 0 && !ex) {
      const seq = await nextCounter(q, 'issue');
      const meta = ISSUE_KINDS.find((k) => k.key === kind);
      const r = await q.query(
        `insert into issues (code, kind, stretch_id, ward, zone, location, count, severity, description, photos, source, reported_by, updated_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'stretch', $11, $11) returning id`,
        [`I-${String(seq).padStart(4, '0')}`, kind, stretch.id, stretch.ward, stretch.zone, JSON.stringify(mid), n, meta?.severity ?? 'medium',
          `Reported on stretch ${stretch.code} (v${version}).`, photos, userId],
      );
      await q.query("insert into issue_events (issue_id, user_id, action, note) values ($1, $2, 'open', $3)",
        [r.rows[0].id, userId, `From stretch ${stretch.code} v${version}`]);
    } else if (n > 0 && ex && ex.count !== n) {
      await q.query('update issues set count = $1, updated_by = $2, updated_at = now() where id = $3', [n, userId, ex.id]);
      await q.query("insert into issue_events (issue_id, user_id, action, changes) values ($1, $2, 'count', $3)",
        [ex.id, userId, JSON.stringify([{ path: 'count', from: ex.count, to: n }])]);
    } else if (n === 0 && ex) {
      await q.query(
        `update issues set status = 'resolved', resolved_by = $1, resolved_at = now(), updated_by = $1, updated_at = now(),
         resolution_note = $2 where id = $3`,
        [userId, `Cleared in stretch ${stretch.code} v${version}.`, ex.id],
      );
      await q.query("insert into issue_events (issue_id, user_id, action, note) values ($1, $2, 'resolve', $3)",
        [ex.id, userId, `Cleared in stretch update v${version}`]);
    }
  }
  const n = (await q.query("select count(*)::int as n from issues where stretch_id = $1 and status <> 'resolved'", [stretch.id])).rows[0].n;
  await q.query('update stretches set open_issues = $1 where id = $2', [n, stretch.id]);
  return n;
}

async function insertVersion(q, v) {
  await q.query(
    `insert into stretch_versions (stretch_id, version, kind, user_id, changes, status, approval, geometry, note, photos, gps,
       gps_distance_m, flagged_far, warnings, batch_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [v.stretch_id, v.version, v.kind, v.user_id, JSON.stringify(v.changes ?? []), v.status, v.approval, v.geometry ?? null,
      v.note ?? null, v.photos ?? [], v.gps ?? null, v.gps_distance ?? null, v.far ?? false, JSON.stringify(v.warnings ?? []),
      v.batch_id ?? null],
  );
}

/** A pipe belongs to one road stretch: refuse pipes already in another live stretch (lengths would count twice). */
async function assertPipesFree(q, pipeIds, selfId = null) {
  if (!pipeIds.length) return;
  const other = (await q.query(
    `select code, pipe_ids from stretches where deleted_at is null and record_state <> 'rejected' and pipe_ids && $1::text[]
       and ($2::uuid is null or id <> $2::uuid) limit 1`, [pipeIds, selfId],
  )).rows[0];
  if (other) {
    const shared = pipeIds.filter((p) => other.pipe_ids.includes(p));
    throw { code: 409, body: { error: `Pipe ${shared.slice(0, 3).join(', ')} is already in stretch ${other.code}. Leave it out, or change ${other.code}.` } };
  }
}

/** Apply status changes to one stretch inside a transaction. Throws {code, body} for client errors. */
async function applyUpdate(q, user, s, input) {
  const current = normaliseStatus(s.status);
  const next = applyChanges(current, input.changes);
  const diff = diffStatus(current, next);
  let geom = s.geometry;
  let pipeIds = s.pipe_ids;
  let ward = s.ward;
  let zone = s.zone;
  const geomChanged = !!input.geometry;
  if (geomChanged) {
    geom = input.geometry;
    pipeIds = knownPipes(input.pipe_ids ?? []);
    ({ ward, zone } = wardOfGeometry(geom));
    if (!canEditWard(user, ward)) throw { code: 403, body: { error: `The new line lies in ward ${ward}, which is not assigned to you.` } };
    await assertPipesFree(q, pipeIds, s.id);
  }
  const nameChanged = input.name !== undefined && (input.name || null) !== (s.name || null);
  if (!diff.length && !geomChanged && !nameChanged && !input.note && !input.photos.length) {
    throw { code: 400, body: { error: 'Nothing changed.' } };
  }
  const length = geomChanged ? lengthM(geom) : s.length_m;
  const planned = geomChanged ? plannedManholes(pipeIds) : s.planned_mh;
  // A rollback restores recorded data, so the rule asking for new photo evidence does not apply to it.
  const check = checkStatus(next, { length_m: length, planned_mh: planned, has_photo: input.photos.length > 0 || !!input.restoring, previous: current });
  if (check.errors.length) throw { code: 400, body: { error: check.errors.join(' '), errors: check.errors, stretch: s.code } };
  let approval = nextApproval(s.approval, next);
  // A rejected restoration recorded again with new photo evidence goes back to the Commissioner.
  if (approval === 'rejected' && input.photos.length > 0 && !input.restoring) approval = 'pending';
  // A redrawn line is not the road that was approved: it needs approving again.
  if (geomChanged && approval === 'approved') approval = 'pending';
  const stage = deriveStage(next, approval);
  const version = s.version + 1;
  const g = gpsCheck(input.gps, geom);
  await q.query(
    `update stretches set status = $1, approval = $2, stage = $3, version = $4, updated_by = $5, updated_at = now(),
       name = $6, geometry = $7, pipe_ids = $8, ward = $9, zone = $10, length_m = $11, planned_mh = $12,
       approved_by = case when $2 = 'approved' then approved_by else null end,
       approved_at = case when $2 = 'approved' then approved_at else null end
     where id = $13`,
    [next, approval, stage, version, user.id, nameChanged ? input.name || null : s.name, geom, pipeIds, ward, zone, length, planned, s.id],
  );
  const changes = diff.map((c) => ({ path: c.path, from: c.from, to: c.to }));
  if (nameChanged) changes.push({ path: 'name', from: s.name, to: input.name || null });
  if (geomChanged) changes.push({ path: 'geometry', from: `${Math.round(s.length_m)} m`, to: `${Math.round(length)} m` });
  if (s.approval !== approval) changes.push({ path: 'approval', from: s.approval, to: approval });
  await insertVersion(q, {
    stretch_id: s.id, version, kind: input.kind ?? 'update', user_id: user.id, changes, status: next, approval,
    geometry: geomChanged ? geom : null, note: input.note, photos: input.photos, gps: input.gps, gps_distance: g.distance,
    far: g.far, warnings: check.warnings, batch_id: input.batch_id,
  });
  await syncIssues(q, { ...s, geometry: geom, ward, zone }, next, user.id, input.photos, version);
  return { version, warnings: check.warnings, far: g.far, distance: g.distance };
}

const sendError = (reply, e) => {
  if (e && e.code && e.body) return reply.code(e.code).send(e.body);
  throw e;
};

// ------------------------------------------------------------------ routes

export function registerStretchRoutes(app, db) {
  const auth = { preHandler: app.authenticate };
  const admin = { preHandler: app.requireRole('admin') };

  app.get('/api/stretches', auth, async () => {
    const rows = (await db.query(`${SELECT_STRETCH} where s.deleted_at is null and s.record_state <> 'rejected' order by s.code`)).rows;
    return { type: 'FeatureCollection', features: rows.map(rowToFeature) };
  });

  app.get('/api/stretches/:id', auth, async (req, reply) => {
    const r = (await db.query(`${SELECT_STRETCH} where s.id = $1`, [req.params.id])).rows[0];
    if (!r) return reply.code(404).send({ error: 'Stretch not found.' });
    const versions = (await db.query(
      `select v.version, v.kind, v.at, v.changes, v.note, v.photos, v.gps, v.gps_distance_m, v.flagged_far, v.warnings, v.approval,
         v.batch_id, u.name as user_name, u.designation as user_designation
       from stretch_versions v left join users u on u.id = v.user_id where v.stretch_id = $1 order by v.version desc`,
      [r.id],
    )).rows;
    const issues = (await db.query('select * from issues where stretch_id = $1 order by reported_at desc', [r.id])).rows;
    return { stretch: rowToFeature(r), versions, issues };
  });

  app.post('/api/stretches', auth, async (req, reply) => {
    const body = createBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Invalid stretch: ' + body.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ') });
    const d = body.data;
    const { ward, zone } = wardOfGeometry(d.geometry);
    if (!canEditWard(req.user, ward)) return reply.code(403).send({ error: `Ward ${ward} is not assigned to you.` });
    const changes = statusToChanges(d.status);
    const problems = changeProblems(changes);
    if (problems.length) return reply.code(400).send({ error: problems.join(' ') });
    const status = applyChanges(defaultStatus(), changes);
    const pipeIds = knownPipes(d.pipe_ids);
    const length = lengthM(d.geometry);
    if (length < 3) return reply.code(400).send({ error: 'The stretch is too short; draw at least 3 m.' });
    const planned = plannedManholes(pipeIds);
    const check = checkStatus(status, { length_m: length, planned_mh: planned, has_photo: d.photos.length > 0 });
    if (check.errors.length) return reply.code(400).send({ error: check.errors.join(' '), errors: check.errors });
    try {
      const out = await db.tx(async (q) => {
        if (!(await photosExist(q, d.photos))) throw { code: 400, body: { error: 'A photo could not be found; upload it again.' } };
        await q.query("select pg_advisory_xact_lock(hashtext('stretch-pipes'))");
        await assertPipesFree(q, pipeIds);
        const seq = await nextCounter(q, `stretch-w${ward}`);
        const code = `W${ward}-${String(seq).padStart(3, '0')}`;
        const approval = nextApproval('none', status);
        const stage = deriveStage(status, approval);
        // A stretch added by an AEE is shown as proposed until the Commissioner approves it.
        const recordState = req.user.role === 'admin' ? 'active' : 'proposed';
        const r = await q.query(
          `insert into stretches (code, name, ward, zone, geometry, length_m, pipe_ids, planned_mh, status, approval, stage, created_by, updated_by, record_state)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12, $13) returning *`,
          [code, d.name || null, ward, zone, d.geometry, length, pipeIds, planned, status, approval, stage, req.user.id, recordState],
        );
        const s = r.rows[0];
        if (recordState === 'proposed') {
          const n = await nextCounter(q, 'change-request');
          await q.query(
            `insert into change_requests (code, entity, action, target_id, payload, reason, ward, zone, requested_by)
             values ($1, 'stretch', 'add', $2, $3, $4, $5, $6, $7)`,
            [`CR-${String(n).padStart(4, '0')}`, s.id, { label: code, name: d.name || null, length_m: Math.round(length) }, d.note ?? null, ward, zone, req.user.id],
          );
        }
        const g = gpsCheck(d.gps, d.geometry);
        await insertVersion(q, {
          stretch_id: s.id, version: 1, kind: 'create', user_id: req.user.id,
          changes: changes.map((c) => ({ path: c.path, from: null, to: c.to })), status, approval, geometry: d.geometry,
          note: d.note, photos: d.photos, gps: d.gps, gps_distance: g.distance, far: g.far, warnings: check.warnings,
        });
        await syncIssues(q, s, status, req.user.id, d.photos, 1);
        return { id: s.id, code, record_state: recordState, warnings: check.warnings, far: g.far, distance: g.distance };
      });
      publish({ entity: 'stretch', id: out.id, action: 'create', by: req.user.name });
      publish({ entity: 'issue', action: 'sync' });
      if (out.record_state === 'proposed') publish({ entity: 'change_request', action: 'create', by: req.user.name });
      return out;
    } catch (e) {
      return sendError(reply, e);
    }
  });

  app.patch('/api/stretches/:id', auth, async (req, reply) => {
    const body = updateBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Invalid update: ' + body.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ') });
    const d = body.data;
    const problems = changeProblems(d.changes);
    if (problems.length) return reply.code(400).send({ error: problems.join(' ') });
    try {
      const out = await db.tx(async (q) => {
        const s = (await q.query('select * from stretches where id = $1 and deleted_at is null for update', [req.params.id])).rows[0];
        if (!s) throw { code: 404, body: { error: 'Stretch not found.' } };
        if (!canEditWard(req.user, s.ward)) throw { code: 403, body: { error: `Ward ${s.ward} is not assigned to you.` } };
        if (!(await photosExist(q, d.photos))) throw { code: 400, body: { error: 'A photo could not be found; upload it again.' } };
        if (d.base_version !== s.version) {
          // Someone saved in between. Accept if they touched other fields; refuse if the same field changed.
          const later = (await q.query('select changes, user_id from stretch_versions where stretch_id = $1 and version > $2', [s.id, d.base_version])).rows;
          const touched = new Set(later.flatMap((v) => v.changes.map((c) => c.path)));
          // Counters that must agree (restored ≤ broken, fixed ≤ leaks) count as one field.
          for (const [a, b] of LINKED_PATHS) if (touched.has(a) || touched.has(b)) { touched.add(a); touched.add(b) }
          const clash = d.changes.filter((c) => touched.has(c.path)).map((c) => c.path);
          if (d.name !== undefined && touched.has('name')) clash.push('name');
          // The Commissioner approved or rejected the restoration meanwhile: a restoration edit must see that first.
          if (touched.has('approval') && d.changes.some((c) => c.path.startsWith('restoration.'))) clash.push('approval');
          // Older history may have been deleted on the Storage page: if we cannot see every change since the
          // editor's version, we cannot tell what they would overwrite, so ask them to review.
          const missing = later.length < s.version - d.base_version;
          if (missing || clash.length || (d.geometry && touched.has('geometry'))) {
            throw { code: 409, body: { error: 'Someone else changed this stretch while you were editing. Review the latest values and save again.', fields: clash, version: s.version } };
          }
        }
        const r = await applyUpdate(q, req.user, s, { ...d, kind: d.geometry ? 'geometry' : 'update' });
        return { id: s.id, code: s.code, ...r };
      });
      publish({ entity: 'stretch', id: out.id, action: 'update', by: req.user.name });
      publish({ entity: 'issue', action: 'sync' });
      return out;
    } catch (e) {
      return sendError(reply, e);
    }
  });

  // Same change applied to many stretches; each gets its own history entry, linked by a batch id.
  app.post('/api/stretches/bulk', auth, async (req, reply) => {
    const body = bulkBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Invalid bulk update.' });
    const d = body.data;
    const problems = changeProblems(d.changes);
    if (problems.length) return reply.code(400).send({ error: problems.join(' ') });
    if (!(await photosExist(db, d.photos))) return reply.code(400).send({ error: 'A photo could not be found; upload it again.' });
    const batch = crypto.randomUUID();
    const results = [];
    for (const id of d.ids) {
      try {
        const r = await db.tx(async (q) => {
          const s = (await q.query('select * from stretches where id = $1 and deleted_at is null for update', [id])).rows[0];
          if (!s) throw { code: 404, body: { error: 'Stretch not found.' } };
          if (!canEditWard(req.user, s.ward)) throw { code: 403, body: { error: `Ward ${s.ward} is not assigned to you.`, stretch: s.code } };
          return { code: s.code, ...(await applyUpdate(q, req.user, s, { ...d, kind: 'bulk', batch_id: batch })) };
        });
        results.push({ id, ok: true, ...r });
      } catch (e) {
        if (!(e && e.code && e.body)) throw e;
        results.push({ id, ok: false, error: e.body.error, code: e.body.stretch });
      }
    }
    publish({ entity: 'stretch', action: 'bulk', by: req.user.name, count: results.filter((r) => r.ok).length });
    publish({ entity: 'issue', action: 'sync' });
    return { batch_id: batch, results };
  });

  async function setApproval(req, reply, to) {
    const parsed = z.object({ note: z.string().trim().max(2000).optional().nullable() }).safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'The note must be text of at most 2,000 characters.' });
    const note = parsed.data.note;
    if (to === 'rejected' && !note) return reply.code(400).send({ error: 'Give a reason for rejecting.' });
    try {
      const out = await db.tx(async (q) => {
        const s = (await q.query('select * from stretches where id = $1 and deleted_at is null for update', [req.params.id])).rows[0];
        if (!s) throw { code: 404, body: { error: 'Stretch not found.' } };
        const status = normaliseStatus(s.status);
        if (status.restoration.stage !== 'restored_curing_done') {
          throw { code: 400, body: { error: 'Only stretches with CC restored and curing done can be approved or rejected.' } };
        }
        if (s.approval === to) throw { code: 400, body: { error: `Already ${to}.` } };
        const version = s.version + 1;
        await q.query(
          `update stretches set approval = $1, stage = $2, version = $3, updated_by = $4, updated_at = now(),
             approved_by = $5, approved_at = $6 where id = $7`,
          [to, deriveStage(status, to), version, req.user.id, to === 'approved' ? req.user.id : null, to === 'approved' ? new Date() : null, s.id],
        );
        await insertVersion(q, {
          stretch_id: s.id, version, kind: to === 'approved' ? 'approve' : 'reject', user_id: req.user.id,
          changes: [{ path: 'approval', from: s.approval, to }], status, approval: to, note,
        });
        return { id: s.id, code: s.code, version };
      });
      publish({ entity: 'stretch', id: out.id, action: to === 'approved' ? 'approve' : 'reject', by: req.user.name });
      return out;
    } catch (e) {
      return sendError(reply, e);
    }
  }
  app.post('/api/stretches/:id/approve', admin, (req, reply) => setApproval(req, reply, 'approved'));
  app.post('/api/stretches/:id/reject', admin, (req, reply) => setApproval(req, reply, 'rejected'));

  // Roll a stretch back to an earlier version's status (recorded as a new version; history is never lost).
  app.post('/api/stretches/:id/revert', admin, async (req, reply) => {
    const parsed = z.object({ version: z.number().int().positive() }).safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'Choose the version to roll back to.' });
    const target = parsed.data.version;
    try {
      const out = await db.tx(async (q) => {
        const s = (await q.query('select * from stretches where id = $1 and deleted_at is null for update', [req.params.id])).rows[0];
        if (!s) throw { code: 404, body: { error: 'Stretch not found.' } };
        const v = (await q.query('select * from stretch_versions where stretch_id = $1 and version = $2', [s.id, target])).rows[0];
        if (!v) throw { code: 404, body: { error: 'Version not found.' } };
        const changes = diffStatus(normaliseStatus(s.status), normaliseStatus(v.status)).map((c) => ({ path: c.path, to: c.to }));
        if (!changes.length) throw { code: 400, body: { error: 'The stretch already matches that version.' } };
        const r = await applyUpdate(q, req.user, s, { changes, photos: [], note: `Rolled back to version ${target}.`, kind: 'revert', restoring: true });
        return { id: s.id, ...r };
      });
      await audit(db, req, 'stretch_revert', 'stretch', out.id, { to_version: target });
      publish({ entity: 'stretch', id: out.id, action: 'revert', by: req.user.name });
      publish({ entity: 'issue', action: 'sync' });
      return out;
    } catch (e) {
      return sendError(reply, e);
    }
  });

  // The Commissioner removes a stretch at once; an AEE's deletion becomes a request for approval.
  app.delete('/api/stretches/:id', auth, async (req, reply) => {
    const reason = z.object({ reason: z.string().trim().max(2000).optional().nullable() }).parse(req.body ?? {}).reason;
    try {
      const out = await db.tx(async (q) => {
        const s = (await q.query('select * from stretches where id = $1 and deleted_at is null for update', [req.params.id])).rows[0];
        if (!s) throw { code: 404, body: { error: 'Stretch not found.' } };
        if (!canEditWard(req.user, s.ward)) throw { code: 403, body: { error: `Ward ${s.ward} is not assigned to you.` } };
        if (req.user.role !== 'admin') {
          if (!reason) throw { code: 400, body: { error: 'Give a reason for the deletion.' } };
          const dup = (await q.query("select code from change_requests where entity = 'stretch' and action = 'delete' and target_id = $1 and status = 'pending'", [s.id])).rows[0];
          if (dup) throw { code: 409, body: { error: `Request ${dup.code} to delete this stretch is already waiting.` } };
          const n = await nextCounter(q, 'change-request');
          const code = `CR-${String(n).padStart(4, '0')}`;
          await q.query(
            `insert into change_requests (code, entity, action, target_id, payload, reason, ward, zone, requested_by)
             values ($1, 'stretch', 'delete', $2, $3, $4, $5, $6, $7)`,
            [code, s.id, { label: s.code, name: s.name }, reason, s.ward, s.zone, req.user.id],
          );
          return { id: s.id, code: s.code, request: code };
        }
        await softDeleteStretch(q, req.user.id, s, reason ? `Removed by the Commissioner: ${reason}` : 'Removed by the Commissioner.');
        return { id: s.id, code: s.code };
      });
      if (out.request) {
        publish({ entity: 'change_request', action: 'create', by: req.user.name });
        return { ...out, pending: true };
      }
      await audit(db, req, 'stretch_delete', 'stretch', out.id, { code: out.code });
      publish({ entity: 'stretch', id: out.id, action: 'delete', by: req.user.name });
      publish({ entity: 'issue', action: 'sync' });
      return out;
    } catch (e) {
      return sendError(reply, e);
    }
  });
}

/** Hide a stretch (kept with its full history) and close the issues raised from it. */
export async function softDeleteStretch(q, userId, s, note) {
  const version = s.version + 1;
  await q.query('update stretches set deleted_at = now(), version = $1, updated_by = $2, updated_at = now() where id = $3', [version, userId, s.id]);
  await insertVersion(q, { stretch_id: s.id, version, kind: 'delete', user_id: userId, status: s.status, approval: s.approval, note });
  await q.query(
    `update issues set status = 'resolved', resolved_by = $1, resolved_at = now(), resolution_note = 'Stretch removed.'
     where stretch_id = $2 and source = 'stretch' and status <> 'resolved'`, [userId, s.id]);
}

export { applyUpdate };

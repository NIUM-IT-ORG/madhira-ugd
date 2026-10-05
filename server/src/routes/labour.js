import { z } from 'zod';
import { audit } from './users.js';
import { publish } from '../events.js';
import { reference } from '../reference.js';

/**
 * Labour and machines deployed per zone per day (one entry per zone per day).
 * Editing: the Commissioner always; field staff for 48 hours after the entry was saved: the person who entered it,
 * or a supervisor (the AEE) for anyone's entry. After that the entry is frozen for them. Every change is recorded.
 */
export const EDIT_HOURS = 48;
const TZ = process.env.TIME_ZONE ?? 'Asia/Kolkata';
const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const isDay = (s) => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
};

const zoneOfWard = (w) => reference.wards.find((f) => f.properties.ward === w)?.properties.zone;
/** Field staff may log for a zone when at least one of its wards is assigned to them. */
export function canLogZone(user, zone) {
  if (!user || !user.active) return false;
  if (user.role === 'admin') return true;
  if (user.role !== 'editor') return false;
  return user.all_wards || (user.wards ?? []).some((w) => zoneOfWard(w) === zone);
}

export function labourRights(user, entry, now = Date.now()) {
  const until = new Date(new Date(entry.created_at).getTime() + EDIT_HOURS * 3600000);
  if (!user || user.role === 'viewer') return { edit: false, until, why: 'Viewers cannot change labour entries.' };
  if (user.role === 'admin') return { edit: true, until };
  if (now > until.getTime()) return { edit: false, until, why: `Frozen: entries can be changed for ${EDIT_HOURS} hours after saving. Ask the Commissioner to correct it.` };
  if (entry.user_id === user.id || user.supervisor) return { edit: true, until };
  return { edit: false, until, why: 'Only the person who entered it, the AEE or the Commissioner can change it.' };
}

const fields = {
  log_date: z.string().refine(isDay, 'Choose a real date.'),
  zone: z.number().int().min(1).max(4),
  labourers: z.number().int().min(0).max(5000),
  machines: z.number().int().min(0).max(500),
  note: z.string().trim().max(500).nullable(),
};
const createBody = z.object({ ...fields, machines: fields.machines.default(0), note: fields.note.optional() });
const patchBody = z.object(fields).partial();

const SELECT = `
  select l.id, to_char(l.log_date, 'YYYY-MM-DD') as log_date, l.zone, l.labourers, l.machines, l.note, l.user_id,
         l.created_at, l.updated_at, l.legacy_wards, u.name as user_name, u.designation as user_designation,
         eu.name as updated_by_name
    from labour_entries l left join users u on u.id = l.user_id left join users eu on eu.id = l.updated_by`;

const withRights = (user) => (e) => {
  const r = labourRights(user, e);
  return { ...e, editable: r.edit, editable_until: r.until.toISOString(), locked_reason: r.edit ? null : r.why };
};

export async function listLabour(db, { from, to, zone } = {}) {
  const where = [];
  const vals = [];
  if (isDay(from)) { vals.push(from); where.push(`l.log_date >= $${vals.length}`); }
  if (isDay(to)) { vals.push(to); where.push(`l.log_date <= $${vals.length}`); }
  if (zone && [1, 2, 3, 4].includes(Number(zone))) { vals.push(Number(zone)); where.push(`l.zone = $${vals.length}`); }
  return (await db.query(`${SELECT} ${where.length ? 'where ' + where.join(' and ') : ''} order by l.log_date desc, l.zone`, vals)).rows;
}

export function registerLabourRoutes(app, db) {
  const auth = { preHandler: app.authenticate };
  const bad = (reply, r) => reply.code(400).send({ error: r.error.issues.map((i) => i.message).join('; ') });

  app.get('/api/labour', auth, async (req) => ({ entries: (await listLabour(db, req.query ?? {})).map(withRights(req.user)), edit_hours: EDIT_HOURS }));

  app.get('/api/labour/:id', auth, async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return reply.code(404).send({ error: 'Entry not found.' });
    const e = (await db.query(`${SELECT} where l.id = $1`, [id])).rows[0];
    if (!e) return reply.code(404).send({ error: 'Entry not found.' });
    const events = (await db.query(
      `select ev.at, ev.action, ev.changes, u.name as user_name from labour_entry_events ev left join users u on u.id = ev.user_id
        where ev.entry_id = $1 order by ev.at desc`, [id],
    )).rows;
    return { entry: withRights(req.user)(e), events };
  });

  app.post('/api/labour', auth, async (req, reply) => {
    const b = createBody.safeParse(req.body);
    if (!b.success) return bad(reply, b);
    const d = b.data;
    if (!canLogZone(req.user, d.zone)) return reply.code(403).send({ error: `Zone ${d.zone} is not assigned to you.` });
    if (d.log_date > todayIST()) return reply.code(400).send({ error: 'The date cannot be in the future.' });
    const out = await db.tx(async (q) => {
      const ex = (await q.query('select id from labour_entries where log_date = $1 and zone = $2', [d.log_date, d.zone])).rows[0];
      if (ex) return { code: 409, body: { error: `Labour for zone ${d.zone} on ${d.log_date} is already entered. Open it to change it.`, id: ex.id } };
      const r = await q.query(
        `insert into labour_entries (log_date, zone, labourers, machines, note, user_id) values ($1, $2, $3, $4, $5, $6) returning id`,
        [d.log_date, d.zone, d.labourers, d.machines, d.note || null, req.user.id],
      );
      await q.query("insert into labour_entry_events (entry_id, user_id, action, changes) values ($1, $2, 'create', $3)",
        [r.rows[0].id, req.user.id, JSON.stringify([{ path: 'labourers', to: d.labourers }, { path: 'machines', to: d.machines }])]);
      return { id: r.rows[0].id };
    });
    if (out.code) return reply.code(out.code).send(out.body);
    publish({ entity: 'labour', action: 'create', by: req.user.name });
    return out;
  });

  app.patch('/api/labour/:id', auth, async (req, reply) => {
    const b = patchBody.safeParse(req.body);
    if (!b.success) return bad(reply, b);
    const d = b.data;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return reply.code(404).send({ error: 'Entry not found.' });
    const out = await db.tx(async (q) => {
      const e = (await q.query('select *, to_char(log_date, \'YYYY-MM-DD\') as day from labour_entries where id = $1 for update', [id])).rows[0];
      if (!e) return { code: 404, body: { error: 'Entry not found.' } };
      const r = labourRights(req.user, e);
      if (!r.edit) return { code: 403, body: { error: r.why } };
      const next = { log_date: e.day, zone: e.zone, labourers: e.labourers, machines: e.machines, note: e.note, ...d };
      if (d.note !== undefined) next.note = d.note || null;
      if (!canLogZone(req.user, next.zone)) return { code: 403, body: { error: `Zone ${next.zone} is not assigned to you.` } };
      if (next.log_date > todayIST()) return { code: 400, body: { error: 'The date cannot be in the future.' } };
      const prev = { log_date: e.day, zone: e.zone, labourers: e.labourers, machines: e.machines, note: e.note };
      const changes = Object.keys(next).filter((k) => String(next[k] ?? '') !== String(prev[k] ?? '')).map((k) => ({ path: k, from: prev[k], to: next[k] }));
      if (!changes.length) return { code: 400, body: { error: 'Nothing changed.' } };
      if (next.log_date !== prev.log_date || next.zone !== prev.zone) {
        const clash = (await q.query('select id from labour_entries where log_date = $1 and zone = $2 and id <> $3', [next.log_date, next.zone, id])).rows[0];
        if (clash) return { code: 409, body: { error: `Zone ${next.zone} on ${next.log_date} already has an entry. Change that one instead.`, id: clash.id } };
      }
      await q.query(
        `update labour_entries set log_date = $1, zone = $2, labourers = $3, machines = $4, note = $5, updated_by = $6, updated_at = now() where id = $7`,
        [next.log_date, next.zone, next.labourers, next.machines, next.note, req.user.id, id],
      );
      await q.query("insert into labour_entry_events (entry_id, user_id, action, changes) values ($1, $2, 'edit', $3)", [id, req.user.id, JSON.stringify(changes)]);
      return { id };
    });
    if (out.code) return reply.code(out.code).send(out.body);
    publish({ entity: 'labour', action: 'update', by: req.user.name });
    return out;
  });

  app.delete('/api/labour/:id', auth, async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return reply.code(404).send({ error: 'Entry not found.' });
    const e = (await db.query(`${SELECT} where l.id = $1`, [id])).rows[0];
    if (!e) return reply.code(404).send({ error: 'Entry not found.' });
    const r = labourRights(req.user, e);
    if (!r.edit) return reply.code(403).send({ error: r.why });
    await db.query('delete from labour_entries where id = $1', [id]);
    await audit(db, req, 'labour_delete', 'labour', id, { log_date: e.log_date, zone: e.zone, labourers: e.labourers, machines: e.machines, note: e.note, entered_by: e.user_name });
    publish({ entity: 'labour', action: 'delete', by: req.user.name });
    return { ok: true };
  });
}

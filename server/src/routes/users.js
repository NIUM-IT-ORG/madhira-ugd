import { z } from 'zod';
import {
  COOKIE, checkPassword, clearFailures, hashPassword, loginBlocked, noteFailure, passwordProblem, publicUser, tempPassword,
} from '../auth.js';
import { publish } from '../events.js';

const WARDS = z.array(z.number().int().min(1).max(22)).max(22);

const createUserBody = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  name: z.string().trim().min(2).max(120),
  designation: z.string().trim().max(120).optional().nullable(),
  phone: z.string().trim().max(30).optional().nullable(),
  role: z.enum(['admin', 'editor', 'viewer']),
  all_wards: z.boolean().default(false),
  wards: WARDS.default([]),
});
const patchUserBody = createUserBody.partial().extend({
  active: z.boolean().optional(),
  reset_password: z.boolean().optional(),
});

export async function audit(db, req, action, entity, entityId, detail) {
  await db.query(
    'insert into audit_log (user_id, action, entity, entity_id, detail, ip) values ($1, $2, $3, $4, $5, $6)',
    [req.user?.id ?? null, action, entity, entityId == null ? null : String(entityId), detail ?? null, req.ip],
  );
}

export function registerUserRoutes(app, db) {
  app.post('/api/auth/login', async (req, reply) => {
    const body = z.object({ email: z.string().trim().toLowerCase(), password: z.string() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Enter email and password.' });
    const key = `${body.data.email}|${req.ip}`;
    if (loginBlocked(key)) return reply.code(429).send({ error: 'Too many attempts. Try again in 15 minutes.' });
    const u = (await db.query('select * from users where email = $1', [body.data.email])).rows[0];
    if (!u || !u.active || !(await checkPassword(body.data.password, u.password_hash))) {
      noteFailure(key);
      return reply.code(401).send({ error: 'Email or password is incorrect.' });
    }
    clearFailures(key);
    await db.query('update users set last_login_at = now() where id = $1', [u.id]);
    app.issueSession(reply, u);
    req.user = u;
    await audit(db, req, 'login', 'user', u.id);
    return { user: publicUser(u) };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: app.authenticate }, async (req) => ({ user: publicUser(req.user) }));

  app.post('/api/auth/password', { preHandler: app.authenticate }, async (req, reply) => {
    const body = z.object({ current: z.string(), next: z.string() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Enter your current and new password.' });
    if (!(await checkPassword(body.data.current, req.user.password_hash))) return reply.code(400).send({ error: 'Current password is incorrect.' });
    const problem = passwordProblem(body.data.next);
    if (problem) return reply.code(400).send({ error: problem });
    const r = await db.query(
      'update users set password_hash = $1, must_change_password = false, token_version = token_version + 1 where id = $2 returning *',
      [await hashPassword(body.data.next), req.user.id],
    );
    app.forgetUser(req.user.id);
    app.issueSession(reply, r.rows[0]);
    await audit(db, req, 'password_change', 'user', req.user.id);
    return { user: publicUser(r.rows[0]) };
  });

  // ---- user management (Commissioner only)
  const admin = { preHandler: app.requireRole('admin') };

  app.get('/api/users', { preHandler: app.authenticate }, async (req) => {
    const rows = (await db.query('select * from users order by role, name')).rows;
    // Everyone may see names (for history and assignment); only the admin sees contact and access details.
    return {
      users: rows.map((u) => (req.user.role === 'admin' ? publicUser(u) : { id: u.id, name: u.name, designation: u.designation, role: u.role })),
    };
  });

  app.post('/api/users', admin, async (req, reply) => {
    const body = createUserBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
    const exists = (await db.query('select 1 from users where email = $1', [body.data.email])).rows.length;
    if (exists) return reply.code(409).send({ error: 'A user with this email already exists.' });
    const pw = tempPassword();
    const d = body.data;
    const r = await db.query(
      `insert into users (email, name, designation, phone, role, all_wards, wards, password_hash, must_change_password)
       values ($1, $2, $3, $4, $5, $6, $7, $8, true) returning *`,
      [d.email, d.name, d.designation ?? null, d.phone ?? null, d.role, d.all_wards, d.wards, await hashPassword(pw)],
    );
    await audit(db, req, 'user_create', 'user', r.rows[0].id, { email: d.email, role: d.role });
    publish({ entity: 'user', id: r.rows[0].id, action: 'create' });
    // The one-time password is returned once, for the Commissioner to pass on; it must be changed at first sign-in.
    return { user: publicUser(r.rows[0]), temp_password: pw };
  });

  app.patch('/api/users/:id', admin, async (req, reply) => {
    const body = patchUserBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues.map((i) => i.message).join('; ') });
    const u = (await db.query('select * from users where id = $1', [req.params.id])).rows[0];
    if (!u) return reply.code(404).send({ error: 'User not found.' });
    const d = body.data;
    if (u.id === req.user.id && (d.role && d.role !== 'admin' || d.active === false)) {
      return reply.code(400).send({ error: 'You cannot remove your own admin access.' });
    }
    const sets = [];
    const vals = [];
    for (const k of ['email', 'name', 'designation', 'phone', 'role', 'all_wards', 'wards', 'active']) {
      if (d[k] !== undefined) {
        vals.push(d[k]);
        sets.push(`${k} = $${vals.length}`);
      }
    }
    let pw = null;
    if (d.reset_password) {
      pw = tempPassword();
      vals.push(await hashPassword(pw));
      sets.push(`password_hash = $${vals.length}`, 'must_change_password = true');
    }
    // Signing out existing sessions when access is reduced or the password is reset.
    if (d.reset_password || d.active === false || d.role) sets.push('token_version = token_version + 1');
    if (!sets.length) return { user: publicUser(u) };
    vals.push(u.id);
    const r = await db.query(`update users set ${sets.join(', ')} where id = $${vals.length} returning *`, vals);
    app.forgetUser(u.id);
    const { reset_password, ...logged } = d;
    await audit(db, req, reset_password ? 'user_password_reset' : 'user_update', 'user', u.id, logged);
    publish({ entity: 'user', id: u.id, action: 'update' });
    return { user: publicUser(r.rows[0]), ...(pw ? { temp_password: pw } : {}) };
  });
}

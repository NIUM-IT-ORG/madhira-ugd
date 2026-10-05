import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from './config.js';

export const COOKIE = 'ugd_session';

export const hashPassword = (pw) => bcrypt.hash(pw, 10);
export const checkPassword = (pw, hash) => bcrypt.compare(pw, hash);

/** Readable one-time password for new users / resets, e.g. "kite-4821-river". */
export function tempPassword() {
  const words = ['river', 'lotus', 'mango', 'tiger', 'cloud', 'stone', 'wheat', 'lake', 'peacock', 'banyan', 'monsoon', 'kite'];
  const pick = () => words[crypto.randomInt(words.length)];
  return `${pick()}-${crypto.randomInt(1000, 9999)}-${pick()}`;
}

export function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Password must be at least 8 characters.';
  if (pw.length > 200) return 'Password is too long.';
  return null;
}

/** Public shape of a user record. */
export function publicUser(u) {
  return {
    id: u.id, email: u.email, name: u.name, designation: u.designation, phone: u.phone, role: u.role,
    all_wards: u.all_wards, wards: u.wards, active: u.active, must_change_password: u.must_change_password,
    created_at: u.created_at, last_login_at: u.last_login_at,
  };
}

export function canEditWard(user, ward) {
  if (!user || !user.active) return false;
  if (user.role === 'admin') return true;
  if (user.role !== 'editor') return false;
  return user.all_wards || (user.wards ?? []).includes(ward);
}

// Simple in-memory brute-force guard: 8 failed logins per email+IP per 15 minutes.
const failures = new Map();
const WINDOW = 15 * 60 * 1000;
export function loginBlocked(key) {
  const f = failures.get(key);
  return f && f.count >= 8 && Date.now() - f.first < WINDOW;
}
export function noteFailure(key) {
  const f = failures.get(key);
  if (!f || Date.now() - f.first > WINDOW) failures.set(key, { count: 1, first: Date.now() });
  else f.count++;
}
export const clearFailures = (key) => failures.delete(key);

export function registerAuth(app, db) {
  const cache = new Map(); // user id -> { user, at }

  async function loadUser(id) {
    const hit = cache.get(id);
    if (hit && Date.now() - hit.at < 15000) return hit.user;
    const u = (await db.query('select * from users where id = $1', [id])).rows[0] ?? null;
    cache.set(id, { user: u, at: Date.now() });
    return u;
  }
  app.decorate('forgetUser', (id) => cache.delete(id));

  app.decorate('issueSession', (reply, user) => {
    const token = jwt.sign({ sub: user.id, tv: user.token_version }, config.jwtSecret, { expiresIn: `${config.sessionDays}d` });
    reply.setCookie(COOKIE, token, {
      path: '/', httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, maxAge: config.sessionDays * 86400,
    });
  });

  app.decorate('sessionUser', async (req) => {
    const token = req.cookies?.[COOKIE];
    if (!token) return null;
    try {
      const claims = jwt.verify(token, config.jwtSecret);
      const u = await loadUser(claims.sub);
      if (!u || !u.active || u.token_version !== claims.tv) return null;
      return u;
    } catch {
      return null;
    }
  });

  // Routes allowed while a one-time password has not yet been replaced.
  const PASSWORD_PENDING_OK = new Set(['/api/auth/me', '/api/auth/password', '/api/auth/logout']);
  app.decorate('authenticate', async (req, reply) => {
    const u = await app.sessionUser(req);
    if (!u) return reply.code(401).send({ error: 'Please sign in.' });
    if (u.must_change_password && !PASSWORD_PENDING_OK.has(req.routeOptions?.url ?? req.url)) {
      return reply.code(403).send({ error: 'Set your own password first.', must_change_password: true });
    }
    req.user = u;
  });

  app.decorate('requireRole', (...roles) => async (req, reply) => {
    if (!req.user) await app.authenticate(req, reply);
    if (reply.sent) return;
    if (!roles.includes(req.user.role)) return reply.code(403).send({ error: 'You do not have permission for this.' });
  });

  // Cross-site request guard: state-changing API calls must carry the app's own header, which a form
  // post from another site cannot set. Together with SameSite=Lax cookies this blocks CSRF.
  // Decoded path: '/%61pi/…' must not slip past checks that look for '/api/'.
  app.decorate('decodedPath', (req) => {
    const p = req.url.split('?')[0];
    try { return decodeURIComponent(p) } catch { return p }
  });
  app.addHook('onRequest', async (req, reply) => {
    if (req.method === 'GET' || req.method === 'HEAD' || !app.decodedPath(req).startsWith('/api/')) return;
    if (req.headers['x-ugd'] !== '1') return reply.code(403).send({ error: 'Missing request header.' });
  });
}

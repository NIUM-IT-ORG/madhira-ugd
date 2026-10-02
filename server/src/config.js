import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const env = process.env;
const production = env.NODE_ENV === 'production';

// Runtime state (embedded database, uploaded photos, generated secrets) lives in one folder: mount it as a volume.
const varDir = env.VAR_DIR ?? path.join(root, 'var');

function secret() {
  if (env.JWT_SECRET) return env.JWT_SECRET;
  // No secret configured: generate one once and keep it in the var folder so sessions survive restarts.
  const file = path.join(varDir, 'jwt-secret');
  fs.mkdirSync(varDir, { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(48).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(file, 'utf8').trim();
}

// Every setting can be overridden with an environment variable, so the same build runs on any host.
export const config = {
  production,
  port: Number(env.PORT ?? 8080),
  host: env.HOST ?? '0.0.0.0',
  // Processed map data (GeoJSON + PMTiles) produced by the pipeline/ scripts.
  dataDir: env.DATA_DIR ?? path.join(root, 'data', 'processed'),
  // Built web app (web/dist). Served by this server in production.
  webDir: env.WEB_DIR ?? path.join(root, 'web', 'dist'),
  varDir,
  // PostgreSQL connection string. Unset = embedded PGlite database in VAR_DIR/db.
  databaseUrl: env.DATABASE_URL || null,
  pgliteDir: path.join(varDir, 'db'),
  uploadDir: env.UPLOAD_DIR ?? path.join(varDir, 'uploads'),
  maxPhotoBytes: Number(env.MAX_PHOTO_MB ?? 8) * 1024 * 1024,
  jwtSecret: secret(),
  sessionDays: Number(env.SESSION_DAYS ?? 14),
  // Secure cookies need HTTPS; on by default in production, off for http://localhost.
  cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : production,
  // Field updates made further than this from the stretch are flagged to the Commissioner.
  farThresholdM: Number(env.FAR_THRESHOLD_M ?? 200),
  // Starting accounts shipped with the release (used only when the users table is empty).
  initialUsersFile: env.INITIAL_USERS_FILE ?? path.join(root, 'deploy', 'initial-users.json'),
  // Alternative first-run administrator (only when there is no initial-users file and no users).
  adminEmail: env.ADMIN_EMAIL ?? null,
  adminPassword: env.ADMIN_PASSWORD ?? null,
  adminName: env.ADMIN_NAME ?? 'Commissioner',
};

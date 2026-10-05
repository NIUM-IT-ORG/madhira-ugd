import fs from 'node:fs';
import path from 'node:path';
import { hashPassword, tempPassword } from './auth.js';
import { config } from './config.js';

/**
 * First run (the users table is empty): create the starting accounts.
 *  1. deploy/initial-users.json (INITIAL_USERS_FILE): the Commissioner, AEE and Field Inspector accounts
 *     shipped with the release, with bcrypt-hashed one-time passwords given in the user guides.
 *  2. Otherwise ADMIN_EMAIL + ADMIN_PASSWORD: a single admin.
 *  3. Otherwise (local trial): an admin whose one-time password is written to VAR_DIR/first-admin.json.
 * Every starting password must be changed at first sign-in.
 */
export async function bootstrapAdmin(db, log) {
  const n = (await db.query('select count(*)::int as n from users')).rows[0].n;
  if (n > 0) return;

  if (fs.existsSync(config.initialUsersFile)) {
    const { users } = JSON.parse(fs.readFileSync(config.initialUsersFile, 'utf8'));
    for (const u of users) {
      await db.query(
        `insert into users (email, name, designation, role, all_wards, wards, password_hash, must_change_password)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        // Release accounts must change their one-time password; a local trial file may set false.
        [u.email.toLowerCase(), u.name, u.designation ?? null, u.role, !!u.all_wards, u.wards ?? [], u.password_hash, u.must_change_password !== false],
      );
    }
    log.warn(`Created ${users.length} starting accounts from ${config.initialUsersFile}`);
    return;
  }

  const email = (config.adminEmail ?? 'commissioner@madhira.local').toLowerCase();
  const password = config.adminPassword ?? tempPassword();
  await db.query(
    `insert into users (email, name, designation, role, all_wards, password_hash, must_change_password)
     values ($1, $2, 'Municipal Commissioner', 'admin', true, $3, true)`,
    [email, config.adminName, await hashPassword(password)],
  );
  if (!config.adminPassword) {
    const file = path.join(config.varDir, 'first-admin.json');
    fs.writeFileSync(file, JSON.stringify({ email, password, note: 'Change this password at first sign-in, then delete this file.' }, null, 1), { mode: 0o600 });
    log.warn(`Created admin ${email}; one-time password saved in ${file}`);
  } else {
    log.info(`Created admin ${email} from ADMIN_EMAIL / ADMIN_PASSWORD`);
  }
}

import fs from 'node:fs';
import path from 'node:path';
import { hashPassword, tempPassword } from './auth.js';
import { config } from './config.js';

/**
 * Starting accounts.
 *  1. deploy/initial-users.json (INITIAL_USERS_FILE): the Commissioner, AEE and Field Inspector accounts
 *     shipped with the release, with bcrypt-hashed one-time passwords given in the user guides.
 *  2. Otherwise ADMIN_EMAIL + ADMIN_PASSWORD: a single admin.
 *  3. Otherwise (local trial): an admin whose one-time password is written to VAR_DIR/first-admin.json.
 * Every starting password must be changed at first sign-in.
 */
export async function bootstrapAdmin(db, log) {
  const n = (await db.query('select count(*)::int as n from users')).rows[0].n;

  if (fs.existsSync(config.initialUsersFile)) {
    // Each starting account is created once, by its key (recorded in starting_accounts). A later release can add
    // accounts to the file; accounts already made are never re-created, even if their email was changed since.
    const { users } = JSON.parse(fs.readFileSync(config.initialUsersFile, 'utf8'));
    const done = new Set((await db.query('select key from starting_accounts')).rows.map((r) => r.key));
    let made = 0;
    for (const u of users) {
      const key = u.key ?? u.email.toLowerCase();
      if (done.has(key)) continue;
      const r = await db.query(
        `insert into users (email, name, designation, role, all_wards, wards, password_hash, must_change_password, supervisor)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (email) do nothing returning id`,
        // Release accounts must change their one-time password; a local trial file may set false.
        [u.email.toLowerCase(), u.name, u.designation ?? null, u.role, !!u.all_wards, u.wards ?? [], u.password_hash,
          u.must_change_password !== false, !!u.supervisor],
      );
      await db.query('insert into starting_accounts (key) values ($1) on conflict do nothing', [key]);
      made += r.rows.length;
    }
    if (made) log.warn(`Created ${made} starting account(s) from ${config.initialUsersFile}`);
    return;
  }
  if (n > 0) return;

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

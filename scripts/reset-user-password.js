'use strict';

// Break-glass password reset for the LOCAL variant — recovery root of trust is
// filesystem access to data/bento.db (see docs/IMPLEMENTATION-LOCAL.md §8).
// Works for ANY user, including the global admin, so it must only be run by
// someone who already has shell access to the host.
//
//   node scripts/reset-user-password.js <username>
//   BENTO_DB=/path/to/bento.db node scripts/reset-user-password.js admin
//
// Resets the password to the default ('bentoos'), sets requires_password_change
// so the next login is forced through the change-password screen, and revokes
// all of that user's sessions.

const path = require('path');
const Database = require('better-sqlite3');
const { hashPasswordSync } = require('../server/password');

const username = (process.argv[2] || '').trim().toLowerCase();
if (!username) {
  console.error('Usage: node scripts/reset-user-password.js <username>');
  process.exit(1);
}

const DB_PATH = process.env.BENTO_DB || path.join(__dirname, '..', 'data', 'bento.db');

let db;
try {
  db = new Database(DB_PATH, { fileMustExist: true });
} catch {
  console.error(`[reset] cannot open database at ${DB_PATH}`);
  process.exit(1);
}
db.pragma('foreign_keys = ON');

const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
if (!user) {
  console.error(`[reset] no user with username "${username}"`);
  process.exit(1);
}

const now = Date.now();
const reset = db.transaction(() => {
  db.prepare('UPDATE users SET password_hash = ?, requires_password_change = 1, updated_at = ? WHERE id = ?')
    .run(hashPasswordSync('bentoos'), now, user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
});
reset();
db.close();

console.log(`[reset] "${username}" password reset to "bentoos" — a new password is forced at next login`);

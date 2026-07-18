'use strict';

// User management (admins) + GDPR self-delete. Mounted behind
// [requireAuth, requirePasswordChanged] in index.js. See IMPLEMENTATION-LOCAL §5.
//
//   GET    /api/users                    (admin)         usernames + roles only
//   POST   /api/users                    (admin)         create a user -> DEFAULT_PASSWORD
//   DELETE /api/users/:id                (global admin)  hard delete (not self, not global_admin)
//   POST   /api/users/:id/reset-password (admin)         normal users only -> 'bentoos'
//   POST   /api/users/:id/promote        (global admin)  user  -> admin
//   POST   /api/users/:id/demote         (global admin)  admin -> user
//   DELETE /api/users/me                 (self)          GDPR hard delete

const express = require('express');
const { db, seedUser } = require('../db');
const { hashPassword } = require('../password');
const {
  requireAdmin, requireGlobalAdmin, destroyUserSessions, clearSessionCookie, withinRateLimit,
} = require('../auth');
const { normalizeUsername, DEFAULT_PASSWORD } = require('../validate');
const { sendError } = require('../errors');

const router = express.Router();

const RESET_MAX_PER_HOUR = 5;
const CREATE_MAX_PER_HOUR = 20;
const HOUR_MS = 60 * 60 * 1000;

function parseId(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Data blindness: usernames + roles + the reset flag only. No password_hash,
// no session/IP data ever leaves the server.
router.get('/', requireAdmin, (req, res) => {
  const users = db.prepare(
    'SELECT id, username, role, requires_password_change FROM users ORDER BY username'
  ).all().map((u) => ({ ...u, requires_password_change: !!u.requires_password_change }));
  res.json({ users });
});

// Admin-driven user creation: new accounts start as a Normal User with the
// default password and a forced change on first login, then get the same
// Welcome-entry/example-prompt seed a self-signup would (server/db.js).
router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const username = normalizeUsername(req.body?.username);

    if (!withinRateLimit(`user-create:${req.user.id}`, CREATE_MAX_PER_HOUR, HOUR_MS)) {
      return sendError(res, 429, 'RATE_LIMITED', 'Too many accounts created — try again later');
    }

    const exists = db.prepare('SELECT 1 FROM users WHERE username = ?').get(username);
    if (exists) return sendError(res, 409, 'USERNAME_TAKEN', 'That User ID is taken');

    const now = Date.now();
    const hash = await hashPassword(DEFAULT_PASSWORD);
    const info = db.prepare(
      `INSERT INTO users (username, password_hash, role, requires_password_change, created_at, updated_at)
       VALUES (?, ?, 'user', 1, ?, ?)`
    ).run(username, hash, now, now);

    try {
      seedUser(info.lastInsertRowid);
    } catch (seedErr) {
      console.warn('[users] seedUser failed for admin-created user', info.lastInsertRowid, seedErr);
    }

    res.status(201).json({
      ok: true,
      user: { id: info.lastInsertRowid, username, role: 'user', requires_password_change: true },
    });
  } catch (e) {
    if (e && e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return sendError(res, 409, 'USERNAME_TAKEN', 'That User ID is taken');
    }
    next(e);
  }
});

// GDPR / PDPA: the caller permanently deletes their own account. Every FK
// (sessions, entries, prompts) cascades. The global admin can't self-delete —
// the singleton superuser must always exist.
router.delete('/me', async (req, res) => {
  if (req.user.role === 'global_admin') {
    return sendError(res, 403, 'FORBIDDEN', 'The global admin account cannot be deleted');
  }
  // Hard delete (GDPR/PDPA). entries/prompts carry no DB-level FK (SQLite
  // ALTER limitation — see migration 003), so cascade them explicitly here;
  // sessions/snippets would cascade via their real FK, but we delete all five
  // in one transaction so nothing of the user survives.
  const uid = req.user.id;
  db.transaction(() => {
    db.prepare('DELETE FROM entries  WHERE user_id = ?').run(uid);
    db.prepare('DELETE FROM prompts  WHERE user_id = ?').run(uid);
    db.prepare('DELETE FROM snippets WHERE user_id = ?').run(uid);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(uid);
    db.prepare('DELETE FROM users    WHERE id = ?').run(uid);
  })();
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

router.post('/:id/reset-password', requireAdmin, async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return sendError(res, 400, 'VALIDATION', 'Invalid user id');

    if (!withinRateLimit(`pw-reset:${req.user.id}`, RESET_MAX_PER_HOUR, HOUR_MS)) {
      return sendError(res, 429, 'RATE_LIMITED', 'Too many password resets — try again later');
    }

    const target = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id);
    if (!target) return sendError(res, 404, 'NOT_FOUND', 'User not found');
    if (target.role !== 'user') {
      return sendError(res, 403, 'FORBIDDEN', 'Only Normal User passwords can be reset');
    }

    const hash = await hashPassword(DEFAULT_PASSWORD);
    db.prepare('UPDATE users SET password_hash = ?, requires_password_change = 1, updated_at = ? WHERE id = ?')
      .run(hash, Date.now(), id);
    destroyUserSessions(id); // force re-login everywhere with the new default
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.post('/:id/promote', requireGlobalAdmin, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return sendError(res, 400, 'VALIDATION', 'Invalid user id');
  const info = db.prepare("UPDATE users SET role = 'admin', updated_at = ? WHERE id = ? AND role = 'user'")
    .run(Date.now(), id);
  if (info.changes === 0) return sendError(res, 400, 'INVALID_TARGET', 'Target must be an existing normal user');
  res.json({ ok: true });
});

router.post('/:id/demote', requireGlobalAdmin, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return sendError(res, 400, 'VALIDATION', 'Invalid user id');
  const info = db.prepare("UPDATE users SET role = 'user', updated_at = ? WHERE id = ? AND role = 'admin'")
    .run(Date.now(), id);
  if (info.changes === 0) return sendError(res, 400, 'INVALID_TARGET', 'Target must be an existing admin');
  res.json({ ok: true });
});

// Global-admin-driven hard delete: never self, never another global_admin
// (the singleton superuser must always exist). Same five-table cascade as
// DELETE /me, plus user_skills (installs the target never gets to keep).
router.delete('/:id', requireGlobalAdmin, (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return sendError(res, 400, 'VALIDATION', 'Invalid user id');
  if (id === req.user.id) return sendError(res, 403, 'FORBIDDEN', 'You cannot delete your own account here');

  const target = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id);
  if (!target) return sendError(res, 404, 'NOT_FOUND', 'User not found');
  if (target.role === 'global_admin') {
    return sendError(res, 403, 'FORBIDDEN', 'The global admin account cannot be deleted');
  }

  db.transaction(() => {
    db.prepare('DELETE FROM entries     WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM prompts     WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM snippets    WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM user_skills WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM sessions    WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM users       WHERE id = ?').run(id);
  })();
  res.json({ ok: true });
});

module.exports = router;

'use strict';

// User management (admins) + GDPR self-delete. Mounted behind
// [requireAuth, requirePasswordChanged] in index.js. See IMPLEMENTATION-LOCAL §5.
//
//   GET    /api/users                    (admin)         usernames + roles only
//   POST   /api/users/:id/reset-password (admin)         normal users only -> 'bentoos'
//   POST   /api/users/:id/promote        (global admin)  user  -> admin
//   POST   /api/users/:id/demote         (global admin)  admin -> user
//   DELETE /api/users/me                 (self)          GDPR hard delete

const express = require('express');
const { db } = require('../db');
const { hashPassword } = require('../password');
const {
  requireAdmin, requireGlobalAdmin, destroyUserSessions, clearSessionCookie, withinRateLimit,
} = require('../auth');
const { DEFAULT_PASSWORD } = require('../validate');
const { sendError } = require('../errors');

const router = express.Router();

const RESET_MAX_PER_HOUR = 5;
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

// GDPR / PDPA: the caller permanently deletes their own account. Every FK
// (sessions, entries, prompts) cascades. The global admin can't self-delete —
// the singleton superuser must always exist.
router.delete('/me', async (req, res) => {
  if (req.user.role === 'global_admin') {
    return sendError(res, 403, 'FORBIDDEN', 'The global admin account cannot be deleted');
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
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

module.exports = router;

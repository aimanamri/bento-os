'use strict';

// Authentication endpoints (local variant). See docs/IMPLEMENTATION-LOCAL.md §5.
//   POST /api/auth/login            {username, password}   -> set cookie
//   POST /api/auth/logout                                  -> clear cookie
//   GET  /api/auth/me                                      -> current user | 401
//   POST /api/auth/change-password  {new_password, current_password?}
//   POST /api/auth/signup           {username, password}   (unless disabled)

const express = require('express');
const { db, seedUser } = require('../db');
const { hashPassword, verifyPassword } = require('../password');
const {
  createSession, destroySession, destroyUserSessions,
  setSessionCookie, clearSessionCookie, withinRateLimit, requireAuth,
} = require('../auth');
const {
  ValidationError, normalizeUsername, requirePassword, newPassword,
} = require('../validate');
const { sendError } = require('../errors');

const router = express.Router();

// Self-signup is on by default; set BENTO_OPEN_SIGNUP=0 to make accounts
// admin-created only (see IMPLEMENTATION-LOCAL §5).
const OPEN_SIGNUP = process.env.BENTO_OPEN_SIGNUP !== '0';

// Login throttle: per-username and per-IP fixed windows.
const LOGIN_MAX = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    requires_password_change: !!u.requires_password_change,
  };
}

router.post('/login', async (req, res, next) => {
  try {
    const username = normalizeUsername(req.body?.username);
    const password = requirePassword(req.body?.password);

    const ip = req.ip || 'unknown';
    if (!withinRateLimit(`login:${username}`, LOGIN_MAX, LOGIN_WINDOW_MS) ||
        !withinRateLimit(`login-ip:${ip}`, LOGIN_MAX * 3, LOGIN_WINDOW_MS)) {
      return sendError(res, 429, 'RATE_LIMITED', 'Too many attempts — wait a few minutes and try again');
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    // Always run a verify to keep timing uniform whether or not the user exists.
    const ok = user
      ? await verifyPassword(password, user.password_hash)
      : await verifyPassword(password, 'scrypt$16384$8$1$AAAA$AAAA');
    if (!user || !ok) {
      return sendError(res, 401, 'BAD_CREDENTIALS', 'Wrong User ID or password');
    }

    const token = createSession(user.id);
    setSessionCookie(req, res, token);
    res.json({ user: publicUser(user) });
  } catch (e) {
    next(e);
  }
});

router.post('/logout', (req, res) => {
  destroySession(req.sessionToken);
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  if (!req.user) return sendError(res, 401, 'UNAUTHENTICATED', 'Sign in required');
  res.json({ user: publicUser(req.user) });
});

// Authenticated, but deliberately NOT behind requirePasswordChanged — this is
// the one data-changing route a forced-rotation user must be able to reach.
router.post('/change-password', requireAuth, async (req, res, next) => {
  try {
    const next_ = newPassword(req.body?.new_password);
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!row) return sendError(res, 401, 'UNAUTHENTICATED', 'Sign in required');

    // Current password is required for a voluntary change; skipped only while
    // in the forced-rotation flow (the user just proved identity at login).
    if (!req.user.requires_password_change) {
      const current = requirePassword(req.body?.current_password);
      if (!(await verifyPassword(current, row.password_hash))) {
        return sendError(res, 403, 'BAD_CREDENTIALS', 'Current password is incorrect');
      }
    }

    const hash = await hashPassword(next_);
    db.prepare('UPDATE users SET password_hash = ?, requires_password_change = 0, updated_at = ? WHERE id = ?')
      .run(hash, Date.now(), req.user.id);

    // Rotate sessions: keep this one, drop every other device.
    destroyUserSessions(req.user.id, req.sessionToken);
    res.json({ user: { ...publicUser(req.user), requires_password_change: false } });
  } catch (e) {
    next(e);
  }
});

router.post('/signup', async (req, res, next) => {
  try {
    if (!OPEN_SIGNUP) {
      return sendError(res, 403, 'SIGNUP_DISABLED', 'New accounts are created by an admin');
    }
    const username = normalizeUsername(req.body?.username);
    const password = newPassword(req.body?.password);

    const exists = db.prepare('SELECT 1 FROM users WHERE username = ?').get(username);
    if (exists) return sendError(res, 409, 'USERNAME_TAKEN', 'That User ID is taken');

    const now = Date.now();
    const hash = await hashPassword(password);
    const info = db.prepare(
      `INSERT INTO users (username, password_hash, role, requires_password_change, created_at, updated_at)
       VALUES (?, ?, 'user', 0, ?, ?)`
    ).run(username, hash, now, now);

    // A seeding bug must never fail signup — warn and move on.
    try {
      seedUser(info.lastInsertRowid);
    } catch (seedErr) {
      console.warn('[auth] seedUser failed for new signup', info.lastInsertRowid, seedErr);
    }

    const token = createSession(info.lastInsertRowid);
    setSessionCookie(req, res, token);
    res.status(201).json({
      user: { id: info.lastInsertRowid, username, role: 'user', requires_password_change: false },
    });
  } catch (e) {
    if (e && e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return sendError(res, 409, 'USERNAME_TAKEN', 'That User ID is taken');
    }
    next(e);
  }
});

module.exports = router;

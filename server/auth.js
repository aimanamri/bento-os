'use strict';

// Session store, cookie plumbing, fixed-window rate limiter, and RBAC
// middleware for the local (SQLite) auth variant. Password hashing lives in
// server/password.js. See docs/IMPLEMENTATION-LOCAL.md §3–§6.

const crypto = require('crypto');
const { db } = require('./db');
const { sendError } = require('./errors');

const COOKIE_NAME = 'bento_sid';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, sliding
const SLIDE_AFTER_MS = 60 * 60 * 1000;           // refresh expiry at most hourly

/* ── prepared statements ─────────────────────────────────────── */

const stmt = {
  insertSession: db.prepare(
    `INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at)
     VALUES (@id, @user_id, @created_at, @expires_at, @last_seen_at)`
  ),
  sessionWithUser: db.prepare(
    `SELECT s.id AS sid, s.expires_at, s.last_seen_at,
            u.id, u.username, u.role, u.requires_password_change
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ?`
  ),
  touchSession: db.prepare('UPDATE sessions SET expires_at = ?, last_seen_at = ? WHERE id = ?'),
  deleteSession: db.prepare('DELETE FROM sessions WHERE id = ?'),
  deleteUserSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
  deleteUserSessionsExcept: db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?'),
  sweepExpired: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),
};

/* ── session tokens ──────────────────────────────────────────── */

// Raw token → cookie value; sha256(token) → the stored id. A DB leak yields
// only hashes, never a replayable token.
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  stmt.insertSession.run({
    id: hashToken(token),
    user_id: userId,
    created_at: now,
    expires_at: now + SESSION_TTL_MS,
    last_seen_at: now,
  });
  return token;
}

// Returns { id, username, role, requires_password_change } or null.
function resolveSession(token) {
  if (!token) return null;
  const row = stmt.sessionWithUser.get(hashToken(token));
  if (!row) return null;
  const now = Date.now();
  if (row.expires_at < now) {
    stmt.deleteSession.run(row.sid);
    return null;
  }
  // Slide expiry forward, but write at most once per SLIDE_AFTER_MS.
  if (now - row.last_seen_at > SLIDE_AFTER_MS) {
    stmt.touchSession.run(now + SESSION_TTL_MS, now, row.sid);
  }
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    requires_password_change: !!row.requires_password_change,
  };
}

function destroySession(token) {
  if (token) stmt.deleteSession.run(hashToken(token));
}

function destroyUserSessions(userId, exceptToken) {
  if (exceptToken) stmt.deleteUserSessionsExcept.run(userId, hashToken(exceptToken));
  else stmt.deleteUserSessions.run(userId);
}

let lastSweep = 0;
function sweepExpiredSessions() {
  const now = Date.now();
  if (now - lastSweep < SLIDE_AFTER_MS) return;
  lastSweep = now;
  stmt.sweepExpired.run(now);
}

/* ── cookies (no dependency) ─────────────────────────────────── */

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

// Secure is set only when the request arrived over TLS (behind
// `tailscale serve`), so plain-HTTP localhost dev still works.
function setSessionCookie(req, res, token) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const attrs = [
    `${COOKIE_NAME}=${token}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (secure) attrs.push('Secure');
  res.append('Set-Cookie', attrs.join('; '));
}

function clearSessionCookie(req, res) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const attrs = [`${COOKIE_NAME}=`, 'HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=0'];
  if (secure) attrs.push('Secure');
  res.append('Set-Cookie', attrs.join('; '));
}

function readSessionToken(req) {
  return parseCookies(req)[COOKIE_NAME] || null;
}

/* ── fixed-window rate limiter ───────────────────────────────── */

const bumpTx = db.transaction((key, windowStart, max) => {
  db.prepare(
    `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
     ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1`
  ).run(key, windowStart);
  const { count } = db.prepare(
    'SELECT count FROM rate_limits WHERE key = ? AND window_start = ?'
  ).get(key, windowStart);
  // Opportunistic cleanup: drop this key's older, now-irrelevant windows.
  db.prepare('DELETE FROM rate_limits WHERE key = ? AND window_start < ?')
    .run(key, windowStart);
  return count <= max;
});

// Returns true while within budget. windowMs is the fixed window; max is the
// allowed hits per window.
function withinRateLimit(key, max, windowMs) {
  const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
  return bumpTx(key, windowStart, max);
}

/* ── middleware ──────────────────────────────────────────────── */

// Attaches req.user (or null) from the session cookie. Never rejects.
function attachUser(req, res, next) {
  sweepExpiredSessions();
  req.sessionToken = readSessionToken(req);
  req.user = resolveSession(req.sessionToken);
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return sendError(res, 401, 'UNAUTHENTICATED', 'Sign in required');
  next();
}

// Blocks every data route until a forced password change is done. The
// change-password / logout / me endpoints opt out (they must stay reachable).
function requirePasswordChanged(req, res, next) {
  if (req.user && req.user.requires_password_change) {
    return sendError(res, 403, 'PASSWORD_CHANGE_REQUIRED', 'You must set a new password before continuing');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return sendError(res, 401, 'UNAUTHENTICATED', 'Sign in required');
  if (req.user.role !== 'admin' && req.user.role !== 'global_admin') {
    return sendError(res, 403, 'FORBIDDEN', 'Admin role required');
  }
  next();
}

function requireGlobalAdmin(req, res, next) {
  if (!req.user) return sendError(res, 401, 'UNAUTHENTICATED', 'Sign in required');
  if (req.user.role !== 'global_admin') {
    return sendError(res, 403, 'FORBIDDEN', 'Global admin role required');
  }
  next();
}

// Defense-in-depth CSRF: SameSite=Strict already stops the cookie riding a
// cross-site request, but we also require a custom header on state-changing
// calls — a value only same-origin `fetch` (never a cross-site form/img) can
// set. The frontend sends it on every api() call.
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
function requireCsrfHeader(req, res, next) {
  if (UNSAFE.has(req.method) && req.get('X-Bento-Request') !== '1') {
    return sendError(res, 403, 'CSRF', 'Missing X-Bento-Request header');
  }
  next();
}

module.exports = {
  COOKIE_NAME,
  createSession,
  resolveSession,
  destroySession,
  destroyUserSessions,
  setSessionCookie,
  clearSessionCookie,
  readSessionToken,
  withinRateLimit,
  attachUser,
  requireAuth,
  requirePasswordChanged,
  requireAdmin,
  requireGlobalAdmin,
  requireCsrfHeader,
};

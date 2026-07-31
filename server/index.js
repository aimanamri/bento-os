'use strict';

const path = require('path');
const express = require('express');
const { db, SCHEMA_VERSION, checkpointAndClose } = require('./db');
const { ValidationError } = require('./validate');
const { sendError } = require('./errors');
const {
  attachUser, requireAuth, requirePasswordChanged, requireCsrfHeader,
} = require('./auth');

const app = express();
app.disable('x-powered-by');
// Trust the reverse proxy (tailscale serve) so req.ip and req.secure reflect
// the real client, not the loopback hop.
app.set('trust proxy', 'loopback');

// SECURITY.md §2/§4 — headers on every response, CSP is the XSS backstop.
// script-src 'self' with no inline allowance: even a sanitizer bypass
// cannot execute. 'unsafe-inline' styles are needed by KaTeX/Mermaid
// style attributes; wasm-unsafe-eval by Mermaid's layout engine.
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; " +
      "style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
      "font-src 'self'; connect-src 'self'; object-src 'none'; " +
      "base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  next();
});

app.use(express.json({ limit: '2mb' }));

// Every /api request resolves req.user from the session cookie (may be null)
// and, on mutations, must carry the CSRF header.
app.use('/api', attachUser, requireCsrfHeader);

app.get('/api/health', (req, res) => {
  res.json({ ok: true, schema: SCHEMA_VERSION, now: Date.now() });
});

// Auth endpoints: login/signup are public; me/change-password guard themselves.
app.use('/api/auth', require('./routes/auth'));

// Content + admin routes require a signed-in user who has cleared any forced
// password change. Per-user data scoping happens inside the routes.
const gate = [requireAuth, requirePasswordChanged];
app.use('/api/entries', gate, require('./routes/entries'));
app.use('/api/prompts', gate, require('./routes/prompts'));
app.use('/api/snippets', gate, require('./routes/snippets'));
app.use('/api/import', gate, require('./routes/import'));
app.use('/api/users', gate, require('./routes/users'));

app.use('/api', (req, res) => sendError(res, 404, 'NOT_FOUND', 'Unknown API route'));

app.use(express.static(path.join(__dirname, '..', 'dist'), { dotfiles: 'deny', index: 'index.html' }));

// Errors: uniform envelope; SQLITE_BUSY → 503 with retry (EDGE-CASES §6.8)
app.use((err, req, res, next) => {
  if (err instanceof ValidationError) return sendError(res, err.status, err.code, err.message);
  if (err.type === 'entity.too.large') return sendError(res, 413, 'TOO_LARGE', 'Request body is limited to 2 MB');
  if (err.type === 'entity.parse.failed') return sendError(res, 400, 'BAD_JSON', 'Request body is not valid JSON');
  if (err.code === 'SQLITE_BUSY') {
    res.set('Retry-After', '1');
    return sendError(res, 503, 'BUSY', 'Database is busy — try again in a moment');
  }
  if (err.code === 'SQLITE_CONSTRAINT_CHECK') {
    return sendError(res, 400, 'VALIDATION', 'Entry needs a non-empty title and details');
  }
  console.error('[server]', err);
  sendError(res, 500, 'INTERNAL', 'Something went wrong on the Bento host');
});

const PORT = Number(process.env.BENTO_PORT) || 3000;
// In a container, bind to 0.0.0.0 so Docker port forwarding works.
// Outside a container, default to loopback only (SECURITY.md §4).
const HOST = process.env.BENTO_HOST || '127.0.0.1';
const server = app.listen(PORT, HOST, () => {
  console.log(`Bento OS serving on http://${HOST}:${PORT} (schema v${SCHEMA_VERSION})`);
  console.log('Expose via: tailscale serve --bg https / http://127.0.0.1:' + PORT);
});

function shutdown() {
  server.close(() => {
    checkpointAndClose();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

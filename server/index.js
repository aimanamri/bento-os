'use strict';

// Static host only. All data access now goes browser → Supabase (PostgreSQL
// + Auth) via the vendored supabase-js SDK; the old SQLite-backed /api
// routes are gone. This process just serves dist/ with hardened headers.

const path = require('path');
const express = require('express');

const app = express();
app.disable('x-powered-by');

// The Supabase project origin, e.g. https://xxxx.supabase.co — needed so the
// CSP connect-src allowlist can be exact. Falls back to *.supabase.co so a
// fresh checkout still works before configuration.
const SUPABASE_ORIGIN = process.env.BENTO_SUPABASE_URL
  ? new URL(process.env.BENTO_SUPABASE_URL).origin
  : 'https://*.supabase.co';
const SUPABASE_WSS = SUPABASE_ORIGIN.replace(/^https:/, 'wss:');

// SECURITY.md §2/§4 — headers on every response, CSP is the XSS backstop.
// script-src 'self' with no inline allowance: even a sanitizer bypass cannot
// execute, and a stolen-session attack cannot exfiltrate outside connect-src.
// connect-src additionally allows the Supabase origin (REST, Auth, Functions,
// Realtime websocket).
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; " +
      "style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
      `font-src 'self'; connect-src 'self' ${SUPABASE_ORIGIN} ${SUPABASE_WSS}; ` +
      "object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  next();
});

app.use(express.static(path.join(__dirname, '..', 'dist'), { dotfiles: 'deny', index: 'index.html' }));

const PORT = Number(process.env.BENTO_PORT) || 3000;
// In a container, bind to 0.0.0.0 so Docker port forwarding works.
// Outside a container, default to loopback only (SECURITY.md §4).
const HOST = process.env.BENTO_HOST || '127.0.0.1';
const server = app.listen(PORT, HOST, () => {
  console.log(`Bento OS static host on http://${HOST}:${PORT} (data: Supabase)`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

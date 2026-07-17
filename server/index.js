'use strict';

// Static host only. All data access now goes browser → Supabase (PostgreSQL
// + Auth) via the vendored supabase-js SDK; the old SQLite-backed /api
// routes are gone. This process just serves dist/ with hardened headers.

const fs = require('fs');
const path = require('path');
const express = require('express');

const app = express();
app.disable('x-powered-by');

// The configured project's SUPABASE_URL, read from the same file the browser
// bundle uses, so the CSP connect-src is pinned to the real project even when
// BENTO_SUPABASE_URL is not set in the environment. Returns null (→ wildcard)
// only for a fresh checkout still carrying a placeholder.
function supabaseOriginFromConfig() {
  try {
    const cfg = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'supabase-config.js'), 'utf8');
    const m = cfg.match(/SUPABASE_URL\s*=\s*['"]([^'"]+)['"]/);
    if (!m) return null;
    const { origin } = new URL(m[1]);
    return origin.includes('*') ? null : origin;
  } catch {
    return null;
  }
}

// CSP connect-src allowlist origin, most-specific source first:
//   1. BENTO_SUPABASE_URL env var (deployment override)
//   2. SUPABASE_URL from supabase-config.js (single source of truth)
//   3. https://*.supabase.co wildcard (unconfigured fresh checkout)
const SUPABASE_ORIGIN = process.env.BENTO_SUPABASE_URL
  ? new URL(process.env.BENTO_SUPABASE_URL).origin
  : (supabaseOriginFromConfig() || 'https://*.supabase.co');
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

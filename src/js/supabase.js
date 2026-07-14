// Supabase client singleton. The SDK is vendored (dist/vendor/supabase.js →
// window.supabase) because CSP `script-src 'self'` forbids CDNs.
//
// Session storage: supabase-js keeps the JWT session in localStorage (pure
// SPA — no SSR, so no HTTP-only cookie channel exists). The CSP with no
// inline scripts is the XSS backstop; tokens never appear in URLs.

import { SUPABASE_URL, SUPABASE_ANON_KEY, AUTH_EMAIL_DOMAIN } from './supabase-config.js';

export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false, // tokens must never ride in URL parameters
  },
});

const USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{1,31}$/;

export function validUsername(u) {
  return USERNAME_RE.test(String(u || '').trim());
}

// Users sign in with a username; auth.users stores username@<domain>.
export function usernameToEmail(username) {
  return `${String(username).trim().toLowerCase()}@${AUTH_EMAIL_DOMAIN}`;
}

export function functionsUrl(name) {
  return `${SUPABASE_URL}/functions/v1/${name}`;
}

'use strict';

// Rewrite src/js/supabase-config.js to match a backend override.
//
// DOCKER IMAGE BUILDS ONLY. Never run this on a working tree: it edits a
// committed source file in place. It is safe inside the `build` stage because
// the source there is a throwaway copy made by `COPY . .`, and it is
// deliberately NOT part of `npm run build` — the dev container bind-mounts your
// real checkout, where this would show up as an unwanted edit. That path is
// handled by the esbuild plugin in build-js.js, which swaps the module in
// memory instead.
//
// Why the runtime image needs this at all: the Dockerfile copies this one
// source file into the runtime so server/index.js can read SUPABASE_URL from it
// and pin the CSP connect-src. Left untouched in a self-hosted build, the image
// would ship the hosted project's URL and anon key — inert (the bundle calls
// the local gateway, and BENTO_SUPABASE_URL overrides the CSP), but present in
// the image, and a wrong CSP the moment the image is run without that variable.
//
// No-op when BENTO_SUPABASE_URL is unset, so cloud builds are unaffected.

const fs = require('fs');
const path = require('path');

const url = process.env.BENTO_SUPABASE_URL || '';
const anonKey = process.env.BENTO_SUPABASE_ANON_KEY || '';

if (!url) {
  console.log('[build] no backend override — supabase-config.js left as committed');
  process.exit(0);
}
if (!anonKey) {
  console.error('[build] BENTO_SUPABASE_URL is set but BENTO_SUPABASE_ANON_KEY is not');
  process.exit(1);
}

const file = path.join(__dirname, '..', 'src', 'js', 'supabase-config.js');
const current = fs.readFileSync(file, 'utf8');

// AUTH_EMAIL_DOMAIN is not a backend detail — it must keep matching the domain
// the admin scripts and Edge Functions synthesize usernames into.
const domain = (current.match(/AUTH_EMAIL_DOMAIN\s*=\s*['"]([^'"]+)['"]/) || [, 'bentoos.local'])[1];

fs.writeFileSync(
  file,
  `// Generated at image build time by scripts/pin-supabase-config.js.
// The committed version of this file points at the hosted Supabase project;
// this image was built against a different backend, so the values below were
// replaced. server/index.js reads SUPABASE_URL from here to pin the CSP.
export const SUPABASE_URL = ${JSON.stringify(url)};
export const SUPABASE_ANON_KEY = ${JSON.stringify(anonKey)};
export const AUTH_EMAIL_DOMAIN = ${JSON.stringify(domain)};
`,
);

console.log(`[build] supabase-config.js in the image pinned to ${url}`);

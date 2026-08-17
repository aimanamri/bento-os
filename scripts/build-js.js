'use strict';

// Bundles the browser modules into a single obfuscated dist/js/app.js.
//
// Everything under src/js/ used to be copied verbatim into dist/, so the
// shipped app was its own source listing: module names, function names and
// comments all readable from devtools. This step replaces that copy with one
// bundle whose identifiers are mangled and whose string literals live in an
// encoded table.
//
// Set BENTO_OBFUSCATE=0 for a readable build with an inline source map —
// the same bundle layout, so a bug is reproduced on the same code path, just
// debuggable. Never ship that build: the source map carries the full source.
//
// What this does NOT do (SECURITY.md §4): obfuscation is not a security
// control. Anything the browser can run, a determined reader can recover.
// Secrets stay server-side; this only raises the cost of casual reading.

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const JavaScriptObfuscator = require('javascript-obfuscator');

const root = path.join(__dirname, '..');
const entry = path.join(root, 'src', 'js', 'main.js');
const outDir = path.join(root, 'dist', 'js');
const outFile = path.join(outDir, 'app.js');

const OBFUSCATE = process.env.BENTO_OBFUSCATE !== '0';

// ---- Backend override -------------------------------------------------
// src/js/supabase-config.js is the committed default and points at the hosted
// Supabase project. The self-hosted Docker stack needs the bundle to call its
// own gateway instead — but it must NOT rewrite that file, because the dev
// container bind-mounts the working tree and would edit the real source.
//
// So the swap happens here, in the bundler: when both variables are set, the
// config module is replaced with generated contents at build time. Unset (the
// normal `npm run build` on your machine) leaves the committed file alone.
//
//   BENTO_SUPABASE_URL        e.g. http://localhost:8000
//   BENTO_SUPABASE_ANON_KEY   the anon JWT for that backend
//
// server/index.js reads the same BENTO_SUPABASE_URL to pin the CSP, so the
// bundle and the connect-src header cannot drift apart.
const configPath = path.join(root, 'src', 'js', 'supabase-config.js');
const OVERRIDE_URL = process.env.BENTO_SUPABASE_URL || '';
const OVERRIDE_ANON_KEY = process.env.BENTO_SUPABASE_ANON_KEY || '';

// Half a config is worse than none: the app would boot and fail every request
// with an opaque 401. Refuse to build instead.
if (Boolean(OVERRIDE_URL) !== Boolean(OVERRIDE_ANON_KEY)) {
  console.error(
    '[build] BENTO_SUPABASE_URL and BENTO_SUPABASE_ANON_KEY must be set together ' +
      `(got URL=${OVERRIDE_URL ? 'set' : 'unset'}, ANON_KEY=${OVERRIDE_ANON_KEY ? 'set' : 'unset'})`,
  );
  process.exit(1);
}

const configOverridePlugin = {
  name: 'bento-supabase-config-override',
  setup(build) {
    build.onLoad({ filter: /supabase-config\.js$/ }, (args) => {
      if (path.resolve(args.path) !== configPath) return null;
      // AUTH_EMAIL_DOMAIN is not a backend detail — it must keep matching the
      // domain the admin scripts and Edge Functions synthesize emails with, so
      // it is carried over from the committed file rather than overridden.
      const current = fs.readFileSync(configPath, 'utf8');
      const domain = (current.match(/AUTH_EMAIL_DOMAIN\s*=\s*['"]([^'"]+)['"]/) || [, 'bentoos.local'])[1];
      return {
        loader: 'js',
        contents:
          `export const SUPABASE_URL = ${JSON.stringify(OVERRIDE_URL)};\n` +
          `export const SUPABASE_ANON_KEY = ${JSON.stringify(OVERRIDE_ANON_KEY)};\n` +
          `export const AUTH_EMAIL_DOMAIN = ${JSON.stringify(domain)};\n`,
      };
    });
  },
};

// main.js ends in a top-level `await initAuth()`, so the bundle stays an ES
// module (index.html loads it with type="module") and needs an es2022 target.
const BUILD = {
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  charset: 'utf8',
  legalComments: 'none',
  logLevel: 'warning',
  plugins: OVERRIDE_URL ? [configOverridePlugin] : [],
};

// CSP is `script-src 'self'` with no 'unsafe-eval' (server/index.js), so every
// option that emits a Function()/eval() trampoline is off: selfDefending and
// debugProtection would produce a bundle the browser refuses to run.
// deadCodeInjection is off for size, not safety.
const OBFUSCATOR_OPTIONS = {
  target: 'browser',
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.5,
  deadCodeInjection: false,
  identifierNamesGenerator: 'mangled-shuffled',
  numbersToExpressions: true,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 10,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.75,
  stringArrayWrappersCount: 2,
  stringArrayWrappersType: 'function',
  transformObjectKeys: true,
  unicodeEscapeSequence: false,
  renameGlobals: false,
  selfDefending: false,
  debugProtection: false,
  disableConsoleOutput: false,
  sourceMap: false,
};

// Async rather than buildSync: esbuild rejects plugins on the synchronous API,
// and the backend override above is implemented as one.
async function bundle() {
  const result = await esbuild.build({
    ...BUILD,
    minify: OBFUSCATE,
    sourcemap: OBFUSCATE ? false : 'inline',
    write: false,
    outfile: outFile,
  });
  return result.outputFiles[0].text;
}

function obfuscate(code) {
  return JavaScriptObfuscator.obfuscate(code, OBFUSCATOR_OPTIONS).getObfuscatedCode();
}

async function main() {
  const bundled = await bundle();
  const code = OBFUSCATE ? obfuscate(bundled) : bundled;

  // The bundle is the whole client: if a module dropped out of the graph the app
  // boots into a blank frame, which is hard to spot in a container build.
  if (code.length < 50_000) {
    console.error(`[build] app.js is only ${code.length} bytes — the module graph looks truncated`);
    process.exit(1);
  }

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, code);

  const kb = (n) => `${(n / 1024).toFixed(0)} kB`;
  console.log(
    `[build] js bundled to dist/js/app.js — ${kb(bundled.length)} bundled, ` +
      `${kb(code.length)} written${OBFUSCATE ? '' : ' (BENTO_OBFUSCATE=0: readable + source map)'}`,
  );
  if (OVERRIDE_URL) {
    console.log(`[build] backend overridden → ${OVERRIDE_URL} (src/js/supabase-config.js not modified)`);
  }
}

main().catch((err) => {
  console.error(`[build] js bundle failed: ${err.message}`);
  process.exit(1);
});

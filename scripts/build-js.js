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

function bundle() {
  const result = esbuild.buildSync({
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

const bundled = bundle();
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

'use strict';

// Vendor the four runtime libraries at their locked versions into dist/.
// CSP (`script-src 'self'`) forbids CDNs by design — SECURITY.md §4.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const nm = path.join(root, 'node_modules');
const out = path.join(root, 'dist', 'vendor');

const files = [
  ['markdown-it/dist/markdown-it.min.js', 'markdown-it.min.js'],
  ['dompurify/dist/purify.min.js', 'purify.min.js'],
  ['katex/dist/katex.min.js', 'katex.min.js'],
  ['katex/dist/contrib/auto-render.min.js', 'auto-render.min.js'],
  ['katex/dist/katex.min.css', 'katex.min.css'],
  ['mermaid/dist/mermaid.min.js', 'mermaid.min.js'],
];

fs.mkdirSync(out, { recursive: true });
for (const [from, to] of files) {
  const srcPath = path.join(nm, from);
  if (!fs.existsSync(srcPath)) {
    console.error(`[build] MISSING vendor file: ${from}`);
    process.exit(1);
  }
  fs.copyFileSync(srcPath, path.join(out, to));
}

// KaTeX css references ./fonts/*
fs.cpSync(path.join(nm, 'katex/dist/fonts'), path.join(out, 'fonts'), { recursive: true });

console.log('[build] vendor libs copied to dist/vendor/');

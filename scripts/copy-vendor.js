'use strict';

// Vendor the five runtime libraries at their locked versions into dist/.
// CSP (`script-src 'self'`) forbids CDNs by design — SECURITY.md §4.
//
// Prism is the exception to the straight copy: npm ships it as a core plus one
// file per language, so it is concatenated here into a single vendor/prism.js
// carrying exactly the grammars listed in PRISM_LANGUAGES.

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

// Prism grammars, in dependency order — a language that extends another must
// follow it (javascript needs clike, cpp needs c, php needs markup-templating).
// Add a language by adding its name here; the file is looked up under
// prismjs/components/ and a typo fails the build rather than silently
// shipping a grammar-less highlighter.
const PRISM_LANGUAGES = [
  'core',
  'markup', 'css', 'clike', 'javascript',
  'typescript', 'jsx', 'json', 'yaml', 'toml', 'ini',
  'bash', 'powershell', 'docker', 'nginx', 'http',
  'python', 'sql', 'go', 'rust', 'java', 'c', 'cpp',
  'markup-templating', 'php', 'ruby',
  'markdown', 'diff', 'regex',
];

// MIT, and the minified components carry no header of their own — so the
// notice travels with the code we redistribute rather than being stripped.
const PRISM_NOTICE = [
  '/*! PrismJS ' + require(path.join(nm, 'prismjs/package.json')).version + ' | https://prismjs.com/',
  ' *  Copyright (c) 2012 Lea Verou — MIT License',
  ' *  Bundled grammars: ' + PRISM_LANGUAGES.slice(1).join(', '),
  ' */',
].join('\n');

const prism = [PRISM_NOTICE];
for (const lang of PRISM_LANGUAGES) {
  const file = path.join(nm, 'prismjs', 'components', `prism-${lang}.min.js`);
  if (!fs.existsSync(file)) {
    console.error(`[build] MISSING Prism grammar: ${lang}`);
    process.exit(1);
  }
  // Trailing semicolon: the minified files do not all end in one, and two
  // concatenated grammars must not run together into a single statement.
  prism.push(fs.readFileSync(file, 'utf8').trim().replace(/;?$/, ';'));
}
fs.writeFileSync(path.join(out, 'prism.js'), prism.join('\n'));

console.log(
  `[build] vendor libs copied to dist/vendor/ (prism.js: ${PRISM_LANGUAGES.length - 1} grammars, ` +
    `${(prism.join('\n').length / 1024).toFixed(0)} kB)`,
);

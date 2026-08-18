'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');

fs.mkdirSync(dist, { recursive: true });
fs.copyFileSync(path.join(src, 'index.html'), path.join(dist, 'index.html'));

// src/js is deliberately NOT copied: build:js bundles it into a single
// obfuscated dist/js/app.js. Copying it here would republish the readable
// modules next to the bundle and undo that step.

// PWA: the manifest and the apple-touch icon are referenced from the document
// head, so they have to sit at the paths index.html names.
fs.copyFileSync(path.join(src, 'manifest.webmanifest'), path.join(dist, 'manifest.webmanifest'));
// One manifest per language: the install prompt, the launcher name and the
// long-press shortcuts are OS chrome, fixed at install time, so they cannot
// follow the in-app toggle. i18n.js repoints <link rel="manifest"> instead.
fs.copyFileSync(path.join(src, 'manifest.ja.webmanifest'), path.join(dist, 'manifest.ja.webmanifest'));

// Icons and any other authored asset. Merges into dist/assets alongside the
// Tailwind output (build:css runs first and writes app.css there).
fs.cpSync(path.join(src, 'assets'), path.join(dist, 'assets'), { recursive: true });

console.log('[build] static copied to dist/');

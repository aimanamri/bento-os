'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');

fs.mkdirSync(dist, { recursive: true });
fs.copyFileSync(path.join(src, 'index.html'), path.join(dist, 'index.html'));
fs.cpSync(path.join(src, 'js'), path.join(dist, 'js'), { recursive: true });

// PWA: the manifest and the apple-touch icon are referenced from the document
// head, so they have to sit at the paths index.html names.
fs.copyFileSync(path.join(src, 'manifest.webmanifest'), path.join(dist, 'manifest.webmanifest'));

// Icons and any other authored asset. Merges into dist/assets alongside the
// Tailwind output (build:css runs first and writes app.css there).
fs.cpSync(path.join(src, 'assets'), path.join(dist, 'assets'), { recursive: true });

console.log('[build] static copied to dist/');

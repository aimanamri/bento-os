'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');

fs.mkdirSync(dist, { recursive: true });
fs.copyFileSync(path.join(src, 'index.html'), path.join(dist, 'index.html'));
fs.cpSync(path.join(src, 'js'), path.join(dist, 'js'), { recursive: true });

console.log('[build] static copied to dist/');

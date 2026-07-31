'use strict';

// Stamps src/sw.js with the real precache list and a build id derived from
// the bytes it will cache. Runs last in `npm run build`, after dist/ is
// complete — the list is read off disk rather than hand-maintained, so a new
// vendor lib or JS module can never be silently left out of offline mode.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');

// Everything the app needs to boot and render with no network. KaTeX's font
// files (~1.1 MB) are deliberately excluded: they are fetched only when a
// note actually contains math, and the runtime cache picks them up then.
const INCLUDE = [
  /^index\.html$/,
  /^manifest\.webmanifest$/,
  /^assets\/app\.css$/,
  /^assets\/icons\/.+\.png$/,
  /^js\/.+\.js$/,
  /^vendor\/[^/]+\.(js|css)$/,
];

function walk(dir, base = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

const files = walk(dist)
  .filter((rel) => INCLUDE.some((re) => re.test(rel)))
  .sort();

if (!files.includes('index.html')) {
  console.error('[build] dist/index.html missing — run build:static first');
  process.exit(1);
}

// Build id = hash of the precached bytes. Identical inputs produce an
// identical worker, so rebuilding without source changes does not churn
// every client's cache.
const hash = crypto.createHash('sha256');
let bytes = 0;
for (const rel of files) {
  const buf = fs.readFileSync(path.join(dist, rel));
  bytes += buf.length;
  hash.update(rel);
  hash.update(buf);
}
const buildId = hash.digest('hex').slice(0, 12);

const urls = files.map((rel) => `/${rel}`);
const template = fs.readFileSync(path.join(root, 'src', 'sw.js'), 'utf8');
const worker = template
  .replace('__BUILD_ID__', buildId)
  .replace('__PRECACHE_URLS__', JSON.stringify(urls, null, 2));

if (worker.includes('__BUILD_ID__') || worker.includes('__PRECACHE_URLS__')) {
  console.error('[build] sw.js placeholders were not substituted');
  process.exit(1);
}

fs.writeFileSync(path.join(dist, 'sw.js'), worker);
// Note on the size: install re-requests these files, but the page has just
// loaded them and express serves max-age=0 + ETag, so it costs a handful of
// 304s rather than the megabytes below. The number is CacheStorage usage.
console.log(`[build] sw.js written — ${files.length} files, ${(bytes / 1024 / 1024).toFixed(1)} MB cached offline, build ${buildId}`);

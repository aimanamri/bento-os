'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { hashPasswordSync } = require('./password');

const SCHEMA_VERSION = 3;
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = process.env.BENTO_DB || path.join(DATA_DIR, 'bento.db');
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');

function runMigrations() {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  )`);

  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version)
  );

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+-.+\.sql$/.test(f))
    .sort();

  for (const file of files) {
    const version = parseInt(file.split('-')[0], 10);
    if (applied.has(version)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const apply = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
        .run(version, file, Date.now());
    });
    apply();
    console.log(`[db] applied migration ${file}`);
  }
}

// Bootstrap the singleton global admin (username: admin / password: bentoos,
// forced to change on first login). Returns the global admin's id. Idempotent:
// once any global admin exists, this is a no-op. Uses the sync hash because
// db.js runs synchronously at module load — see server/password.js.
function ensureGlobalAdmin() {
  const existing = db.prepare("SELECT id FROM users WHERE role = 'global_admin'").get();
  if (existing) return existing.id;
  const now = Date.now();
  const info = db
    .prepare(
      `INSERT INTO users (username, password_hash, role, requires_password_change, created_at, updated_at)
       VALUES ('admin', ?, 'global_admin', 1, ?, ?)`
    )
    .run(hashPasswordSync('bentoos'), now, now);
  console.log('[db] bootstrapped global admin — username: admin, password: bentoos (change required on first login)');
  return info.lastInsertRowid;
}

// Migration 003 adds entries.user_id / prompts.user_id with a sentinel 0.
// Assign any pre-existing (single-user era) rows to the global admin. The
// user_id immutability triggers deliberately allow this one-time 0 -> id move.
function backfillOwnerless(adminId) {
  db.prepare('UPDATE entries SET user_id = ? WHERE user_id = 0').run(adminId);
  db.prepare('UPDATE prompts SET user_id = ? WHERE user_id = 0').run(adminId);
}

// Welcome seeds double as a render self-test: they exercise markdown,
// KaTeX, Mermaid, and all three alert blocks on first boot (UX-SPEC §7).
// Now scoped to the global admin — seeded only when that user has none.
function seed(ownerId) {
  const now = Date.now();

  const entryCount = db.prepare('SELECT COUNT(*) AS n FROM entries WHERE user_id = ?').get(ownerId).n;
  if (entryCount === 0) {
    const welcomeBody = [
      '# Welcome to Bento OS 🍱',
      '',
      'This entry is a working demo of everything the LogBook can render. Edit it, or press **+ New Entry** to start your own.',
      '',
      '## Formatting basics',
      '',
      'You can write **bold**, *italic*, ~~strikethrough~~, and `inline code`.',
      '',
      '- [ ] An unchecked task',
      '- [x] A completed task',
      '',
      '```js',
      'function greet(name) {',
      "  return `Hello, ${name}!`;",
      '}',
      '```',
      '',
      '## Math with KaTeX',
      '',
      'Inline math like $E = mc^2$ flows with the text. Block math stands alone:',
      '',
      '$$\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}$$',
      '',
      '## Diagrams with Mermaid',
      '',
      '```mermaid',
      'flowchart LR',
      '  A[Write markdown] --> B{Renders?}',
      '  B -->|Yes| C[Ship it]',
      '  B -->|No| D[Check the error chip]',
      '  D --> A',
      '```',
      '',
      '## Alert blocks',
      '',
      '> ✅ **Success:** Use these for confirmed fixes and working solutions.',
      '',
      '> ℹ️ **Info:** Use these for context, links, and background notes.',
      '',
      '> ⚠️ **Warning:** Use these for gotchas, breaking changes, and sharp edges.',
      '',
      'Open the **💡 bulb** in the toolbar for copy-paste LaTeX and Mermaid boilerplate, or the **Guide** in the sidebar for the full syntax reference.',
    ].join('\n');

    db.prepare(
      `INSERT INTO entries (user_id, title, body_md, summary, label, sublabel, tags, fields, urls, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      ownerId,
      'Welcome to Bento OS',
      welcomeBody,
      'A working tour of the LogBook: markdown, checkboxes, code, KaTeX math, Mermaid diagrams, and alert blocks.',
      'Guides',
      'Getting Started',
      JSON.stringify(['welcome', 'demo']),
      JSON.stringify({ os_platform: 'macOS', is_valid: 'true' }),
      JSON.stringify(['https://www.markdownguide.org/basic-syntax/']),
      now,
      now
    );
  }

  const promptCount = db.prepare('SELECT COUNT(*) AS n FROM prompts WHERE user_id = ?').get(ownerId).n;
  if (promptCount === 0) {
    db.prepare(
      `INSERT INTO prompts (user_id, title, category, body, why_this_works, tags, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      ownerId,
      'Explain a concept at my level',
      'LEARNING',
      'Explain {{Topic}} to someone with {{Experience Level}} experience. Start with a one-sentence summary, then a concrete example, then the three most common misconceptions. Keep it under 400 words.',
      'Pinning the audience ("{{Experience Level}}") stops the model from hedging across all levels at once. Demanding summary → example → misconceptions forces a structure that surfaces real understanding instead of a definition dump, and the word cap keeps it scannable. Toggle "Fill In and Copy" to try the variables.',
      JSON.stringify(['learning', 'template']),
      now,
      now
    );
  }
}

runMigrations();
const globalAdminId = ensureGlobalAdmin();
backfillOwnerless(globalAdminId);
seed(globalAdminId);

function checkpointAndClose() {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
  } catch (e) {
    // closing on shutdown — nothing useful left to do with a failure
  }
}

module.exports = { db, SCHEMA_VERSION, DB_PATH, checkpointAndClose };

# Bento OS — Implementation Plan

> Companion documents: [SECURITY.md](SECURITY.md) · [EDGE-CASES.md](EDGE-CASES.md) · [UX-SPEC.md](UX-SPEC.md)
> Source of truth for requirements: [../PROJECT-BRIEF.md](../PROJECT-BRIEF.md)

---

## 1. Architecture Overview

```
┌─────────────────────────── Laptop host ───────────────────────────┐
│                                                                    │
│  Browser (any tailnet device)                                      │
│     │  HTTPS via `tailscale serve`                                 │
│     ▼                                                              │
│  Express.js  (bound to 127.0.0.1:3000 ONLY)                        │
│     ├── serves static frontend  (dist/: HTML, compiled CSS, JS)    │
│     └── REST API  /api/*                                           │
│           │                                                        │
│           ▼                                                        │
│  better-sqlite3 → bento.db  (WAL mode, single file)                │
└────────────────────────────────────────────────────────────────────┘
```

**Key decisions**

| Decision | Choice | Rationale |
|---|---|---|
| Frontend framework | None (Vanilla ES6+ modules) | Brief mandate; zero framework overhead; ES modules give clean file boundaries |
| State management | Native `CustomEvent` bus on a shared `EventTarget` | Tab swaps, list refreshes, ribbon actions stay decoupled without a library |
| Styling | Tailwind CSS via CLI compiler (not CDN) | CDN build is blocked by CSP (`default-src 'self'`) and is dev-only per Tailwind docs; compiled build enforces the design-token system |
| SQLite driver | `better-sqlite3` | Synchronous API is simplest + fastest for a single-user local app; first-class prepared statements |
| Markdown parser | `markdown-it` | Pluggable (needed for KaTeX/Mermaid fence hooks), strict CommonMark, battle-tested |
| Search | SQLite FTS5 virtual tables | Millisecond full-text search across titles/tags/body without an external engine |

### Repository layout (target)

```
BentoOS/
├── PROJECT-BRIEF.md
├── docs/                     # These planning docs
├── server/
│   ├── index.js              # Express bootstrap, middleware, static serving
│   ├── db.js                 # better-sqlite3 init, PRAGMAs, migrations runner
│   ├── migrations/           # 001-init.sql, 002-*.sql (append-only)
│   └── routes/
│       ├── entries.js        # Docs LogBook CRUD + search
│       ├── prompts.js        # Prompt Library CRUD + search
│       └── import.js         # Markdown file import
├── src/                      # Frontend source
│   ├── index.html
│   ├── css/input.css         # Tailwind directives + design tokens
│   └── js/
│       ├── main.js           # App bootstrap, tab router, dock
│       ├── bus.js            # Shared EventTarget + typed event names
│       ├── api.js            # fetch wrapper (ETag/updated_at aware)
│       ├── logbook/          # editor.js, preview.js, ribbon.js, sidebar.js, autosave.js
│       ├── prompts/          # cards.js, variables.js, filters.js
│       └── render/           # pipeline.js (md→katex→mermaid→DOMPurify), errors.js
├── dist/                     # Build output (gitignored)
├── tailwind.config.js
└── package.json
```

---

## 2. Data Model (SQLite, WAL mode)

### PRAGMAs applied at every connection open

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous  = NORMAL;   -- safe with WAL, much faster
PRAGMA busy_timeout = 5000;     -- ride out checkpoint locks
PRAGMA foreign_keys = ON;
```

### Tables

```sql
CREATE TABLE entries (
  id          INTEGER PRIMARY KEY,
  title       TEXT    NOT NULL CHECK (length(trim(title)) > 0),
  body_md     TEXT    NOT NULL CHECK (length(trim(body_md)) > 0),
  summary     TEXT    DEFAULT '',
  label       TEXT    NOT NULL DEFAULT 'Uncategorized',
  sublabel    TEXT    DEFAULT NULL,
  tags        TEXT    NOT NULL DEFAULT '[]',   -- JSON array of strings
  fields      TEXT    NOT NULL DEFAULT '{}',   -- user-defined name/value metadata (migration 002; replaced platform/is_valid)
  urls        TEXT    NOT NULL DEFAULT '[]',   -- JSON array of strings
  created_at  INTEGER NOT NULL,                -- UNIX ms; immutable (see trigger)
  updated_at  INTEGER NOT NULL                 -- UNIX ms; auto-bumps on save, user-editable ("Modified"); also the concurrency token
);

-- created_at immutability enforced in the DB, not just app code:
CREATE TRIGGER entries_created_at_immutable
BEFORE UPDATE OF created_at ON entries
BEGIN
  SELECT RAISE(ABORT, 'created_at is immutable');
END;

CREATE TABLE prompts (
  id             INTEGER PRIMARY KEY,
  title          TEXT    NOT NULL CHECK (length(trim(title)) > 0),
  category       TEXT    NOT NULL DEFAULT 'GENERAL',  -- all-caps group label
  body           TEXT    NOT NULL,                    -- may contain {{Variables}}
  why_this_works TEXT    DEFAULT '',
  tags           TEXT    NOT NULL DEFAULT '[]',
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
```

### Full-text search (FTS5)

```sql
CREATE VIRTUAL TABLE entries_fts USING fts5(
  title, tags, summary, body_md,
  content='entries', content_rowid='id', tokenize='porter unicode61'
);
-- AFTER INSERT / UPDATE / DELETE triggers keep entries_fts in sync.
-- Same pattern for prompts_fts (title, tags, category, body).
```

Tags/labels are stored denormalized (JSON in-row) — correct for a single-user
tool; hierarchical Label → Sub-label needs no join table because the hierarchy
is only ever one level deep and is filtered client-side after fetch.

---

## 3. REST API Contract

All bodies are JSON. All timestamps are UNIX milliseconds. Every write
response includes the row's new `updated_at` — the client sends it back on
the next `PUT` for stale-write detection (see EDGE-CASES.md § Multi-device).

| Method & path | Purpose | Notes |
|---|---|---|
| `GET /api/health` | Liveness + schema version | Used by the frontend boot check |
| `GET /api/entries?q=&tag=&label=` | List (FTS when `q` present) | Returns list-view fields only (no `body_md`) for a fast sidebar |
| `GET /api/entries/:id` | Full entry | |
| `POST /api/entries` | Create | 400 on blank title/body (mirrors DB CHECK) |
| `PUT /api/entries/:id` | Update | Requires `expected_updated_at`; **409 Conflict** if row is newer |
| `DELETE /api/entries/:id` | Delete | Soft-confirm handled client-side |
| `GET/POST/PUT/DELETE /api/prompts[...]` | Same shape as entries | |
| `POST /api/import` | Markdown file → new entry | `.md` only, ≤ 2 MB; title from first `# H1` or filename; see SECURITY.md |

Error envelope (uniform): `{ "error": { "code": "CONFLICT", "message": "…" } }`
with proper HTTP status — the frontend maps `code` to toast/modal copy.

---

## 4. Frontend Runtime Design

### Event bus (`bus.js`)

A single `new EventTarget()` with namespaced event constants:

```
tab:activate        { tabId }
entry:saved         { id, updated_at }
entry:dirty         { isDirty }
list:refresh        { source: 'save' | 'focus-sync' | 'import' }
window:minimize     { tabId }        // red traffic light
window:focusmode    { on }           // yellow traffic light
draft:restored      { id | null }
```

Rule: modules never call each other directly across feature folders — they
publish/subscribe on the bus. This keeps LogBook and Prompt Library fully
independent tabs and makes Phase-2 tools (new tabs) drop-in.

### Render pipeline (`render/pipeline.js`) — the single choke point

```
raw markdown
  → markdown-it (html:false at parser level as belt)
  → KaTeX auto-render on math delimiters ($…$, $$…$$)   [try/catch per block]
  → Mermaid render for ```mermaid fences                 [try/catch per block]
  → DOMPurify.sanitize(html, BENTO_PURIFY_CONFIG)        [suspenders]
  → mount into preview node
```

Exactly one function produces DOM from user markdown. Nothing else ever
calls `innerHTML` with user content. Config details in SECURITY.md § 2.

### Autosave (`logbook/autosave.js`)

- `setInterval` 10 s; writes `{entryId|null, title, body_md, meta, savedAt}` to
  `localStorage['bento.draft.v1']` **only when dirty** (skip idle writes).
- Cleared on successful server save. Restore flow on boot: see EDGE-CASES.md.

### Focus-sync listener

`window.addEventListener('focus', …)` → refetch list + open entry **unless**
the editor is dirty (never clobber unsaved work — banner instead). Debounced
30 s so rapid alt-tabbing doesn't hammer the API over a mobile tailnet link.

---

## 5. Build Phases (execution order, post-approval of code work)

| Phase | Scope | Exit criteria |
|---|---|---|
| **A — Scaffold** | package.json, Tailwind CLI pipeline, Express static+health, db.js with PRAGMAs + migration 001, bus.js | `npm run dev` serves shell page; `/api/health` returns schema version |
| **B — Docs LogBook** | Entries CRUD, sidebar + FTS search, editor/preview split, ribbon, syntax cheat-sheet, render pipeline, autosave, guards | Every EDGE-CASES.md § LogBook row demonstrably handled |
| **C — Prompt Library** | Prompts CRUD, search + pill filters, category groups, cards, `{{var}}` Fill-In-and-Copy, card back | Every EDGE-CASES.md § Prompts row handled |
| **D — Security hardening** | CSP + headers, import limits, DOMPurify config audit vs SECURITY.md, run `/security-review` | Zero findings on the SECURITY.md checklist |
| **E — UX polish** | Invoke `ui-ux-pro-max` skill; traffic lights, dock, Focus Mode, transitions, a11y pass, empty states | UX-SPEC.md acceptance checklist green |

Phase order is deliberate: the render pipeline and its sanitizer land in B
(first user-content rendering), not deferred to D — D is an audit, not the
introduction of security.

## 6. Deployment (Tailscale)

1. Express listens on `127.0.0.1:3000` — **never** `0.0.0.0`. The app is
   unreachable even on the LAN except through Tailscale.
2. `tailscale serve --bg https / http://127.0.0.1:3000` exposes it at
   `https://<machine>.<tailnet>.ts.net` with an automatic valid TLS cert.
   HTTPS is functionally required: the async Clipboard API (Prompt Library's
   core "Copy" action) only exists in secure contexts.
3. No funnel, no port-forward, no public exposure — access list is the tailnet.
4. `bento.db*` (db + `-wal` + `-shm`) lives outside `dist/`; backup guidance
   in SECURITY.md § 5.

## 7. Skill Map for the Build

| When | Skill | Why |
|---|---|---|
| Phase E (and any UI-building step) | `ui-ux-pro-max` | Its domain is exactly this design language: bento grid, glassmorphism, dark mode, responsive |
| Any published plan/report page | `artifact-design` | Required before using the Artifact tool |
| Phase D | `security-review` | Automated pass over pending changes |
| End of B and C | `verify` | Drive the real app end-to-end, not just tests |
| Optional polish passes | `impeccable`, `frontend-design` | Micro-interaction & aesthetic refinement |

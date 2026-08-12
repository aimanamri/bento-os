# Bento OS — Implementation Plan

> Companion documents: [SECURITY.md](SECURITY.md) · [EDGE-CASES.md](EDGE-CASES.md) · [UX-SPEC.md](UX-SPEC.md)
> Backend specs: [IMPLEMENTATION-SUPABASE.md](IMPLEMENTATION-SUPABASE.md) · [DATABASE-SUPABASE.md](DATABASE-SUPABASE.md) (default) · [IMPLEMENTATION-LOCAL.md](IMPLEMENTATION-LOCAL.md) · [DATABASE-LOCAL.md](DATABASE-LOCAL.md) (testing)
> Source of truth for requirements: [../PROJECT-BRIEF.md](../PROJECT-BRIEF.md)
>
> **Status: this document describes the app as it is currently built**, not
> just a plan. Phases A–E (original Phase 1 scope) are complete and running;
> § 8 records what was added afterward, including the move to Supabase.

> ### Backend model (read this first)
>
> Bento OS runs on one of two interchangeable backends behind the same
> frontend. **The default — and the production backend for this project — is
> Supabase (PostgreSQL + Auth), accessed from the browser via `supabase-js`**
> under Row-Level Security. The **local single-file SQLite + Express backend
> is the testing/offline variant** — convenient for a self-contained dev loop
> with no cloud dependency, and the origin the app grew from.
>
> The frontend is backend-agnostic: everything goes through one `api()` layer
> (§ 3) whose response shapes, error codes, and optimistic-concurrency
> contract are identical on both. Because of that, most of this document
> (frontend runtime § 4, render pipeline, prompt engine, UX) applies verbatim
> to either backend. Where the backend matters — data model, auth, RBAC,
> deployment — the **default (Supabase)** is stated first and the **testing
> (SQLite)** details follow, each cross-linked to its dedicated spec:
>
> | Concern | Default — Supabase | Testing — local SQLite |
> |---|---|---|
> | Implementation | [IMPLEMENTATION-SUPABASE.md](IMPLEMENTATION-SUPABASE.md) | [IMPLEMENTATION-LOCAL.md](IMPLEMENTATION-LOCAL.md) |
> | Data model | [DATABASE-SUPABASE.md](DATABASE-SUPABASE.md) | [DATABASE-LOCAL.md](DATABASE-LOCAL.md) |
> | Isolation | RLS (`user_id = auth.uid()`) | route-layer `WHERE user_id = ?` |
> | Sessions | JWT (supabase-js) | httpOnly-cookie server sessions |

---

## 1. Architecture Overview

### Default — Supabase (production)

```
┌── Static host (Express or any CDN) ──┐        ┌──────── Supabase ────────┐
│  Browser (SPA, dist/)                │        │  GoTrue  Auth (JWT)      │
│    ├── HTML / compiled CSS / JS      │──JWT──▶ │  PostgREST  entries/…    │
│    └── supabase-js  (vendored UMD)   │        │    under Row-Level Sec.  │
│         └── api() adapter (§3)       │        │  Edge Functions          │
│              ▲ same contract         │        │    (admin resets, GDPR)  │
└──────────────┼───────────────────────┘        └──────────────────────────┘
   Express serves dist/ + CSP headers only; it owns no data.
```

Per-user isolation is enforced by Postgres **Row-Level Security**
(`user_id = auth.uid()`); auth, RBAC, and the singleton global admin live in
Supabase. Full spec: [IMPLEMENTATION-SUPABASE.md](IMPLEMENTATION-SUPABASE.md)
and [DATABASE-SUPABASE.md](DATABASE-SUPABASE.md).

### Testing — local SQLite + Express (offline dev variant)

```
┌─────────────────────────── Laptop host ───────────────────────────┐
│  Browser (any tailnet device)  ──HTTPS via `tailscale serve`──▶    │
│  Express.js  (127.0.0.1:3000 ONLY)                                 │
│     ├── serves static frontend  (dist/)                            │
│     └── REST API  /api/*  (auth, RBAC, per-user scoping in-route)  │
│           ▼                                                        │
│  better-sqlite3 → bento.db  (WAL mode, single file)                │
└────────────────────────────────────────────────────────────────────┘
```

A self-contained, no-cloud loop for development and testing. Isolation is a
route-layer `WHERE user_id = ?` discipline; sessions are server-side in an
httpOnly cookie. Full spec: [IMPLEMENTATION-LOCAL.md](IMPLEMENTATION-LOCAL.md)
and [DATABASE-LOCAL.md](DATABASE-LOCAL.md).

**Key decisions**

| Decision | Choice | Rationale |
|---|---|---|
| Frontend framework | None (Vanilla ES6+ modules) | Brief mandate; zero framework overhead; ES modules give clean file boundaries |
| State management | Native `CustomEvent` bus on a shared `EventTarget`, used sparingly | Only for the handful of events that genuinely cross feature boundaries (see § 4); most state changes are direct function calls |
| Styling | Tailwind CSS via CLI compiler (not CDN) | CDN build is blocked by CSP (`default-src 'self'`) and is dev-only per Tailwind docs; compiled build enforces the design-token system |
| **Default backend** | **Supabase (PostgreSQL + Auth)** | Managed multi-user data + auth with engine-enforced RLS; the browser talks to it directly via `supabase-js`, so no bespoke API server to run in production |
| Testing backend | `better-sqlite3` + Express | Single-file, zero-dependency offline loop; synchronous API, first-class prepared statements |
| Markdown parser | `markdown-it` | Pluggable (needed for the sup/sub inline rule), strict CommonMark, battle-tested |
| Search | Postgres FTS (tsvector + GIN) by default; SQLite FTS5 in the testing backend | Full-text search across titles/tags/summary/body/fields; both are queried through the same `api()` layer |

### Repository layout (actual, flat — not nested by feature)

```
BentoOS/
├── PROJECT-BRIEF.md
├── docs/                     # This planning/spec set
├── server/
│   ├── index.js              # Express bootstrap, CSP/security headers, static serving, error handler
│   ├── db.js                 # better-sqlite3 init, PRAGMAs, migration runner, dev seeds
│   ├── validate.js           # All request-body normalization/validation (shared by every route)
│   ├── errors.js             # sendError() — uniform { error: { code, message } } envelope
│   ├── migrations/
│   │   ├── 001-init.sql      # entries, prompts, *_fts virtual tables + sync triggers
│   │   └── 002-dynamic-fields.sql  # adds entries.fields, drops platform/is_valid, rebuilds entries_fts
│   └── routes/
│       ├── entries.js        # Docs LogBook CRUD + FTS search
│       ├── prompts.js        # Prompt Library CRUD + FTS search
│       └── import.js         # Markdown file import (title extraction, BOM/CRLF normalization)
├── src/                      # Frontend source (flat — no feature subfolders)
│   ├── index.html
│   ├── css/input.css         # Tailwind directives + design tokens + all component/utility CSS
│   └── js/
│       ├── main.js           # App bootstrap: theme, tabs, traffic lights, dock, health check
│       ├── bus.js             # Shared EventTarget — 4 events total, see § 4
│       ├── api.js             # fetch wrapper: 10s timeout, ApiError with server's error envelope
│       ├── ui.js               # Modal/banner/toast/announce — the shared feedback vocabulary
│       ├── render.js           # THE render pipeline (markdown-it → KaTeX → Mermaid → DOMPurify)
│       ├── clipboard.js        # copyText(): Clipboard API → execCommand → manual-copy modal
│       ├── ribbon.js           # LogBook formatting ribbon + 💡 bulb menu + Markdown Guide content
│       ├── logbook.js          # Docs LogBook: sidebar, editor, metadata, autosave, sync, guards
│       └── prompts.js          # Prompt Library: cards, filters, inline variable-editing engine
├── scripts/
│   ├── copy-static.js        # Copies src/index.html + PWA assets into dist/ (not src/js/)
│   ├── copy-vendor.js        # Vendors the 5 runtime lib files into dist/vendor/ (CSP forbids CDNs)
│   └── build-js.js           # Bundles src/js/ into one obfuscated dist/js/app.js
├── dist/                     # Build output (gitignored)
├── data/                     # bento.db + -wal/-shm (gitignored)
├── backups/                  # .backup snapshots (gitignored)
├── tailwind.config.js
└── package.json
```

There is deliberately no framework and no per-feature folder nesting — one
file per concern, authored as native ES modules. The only build step over them
is `scripts/build-js.js`, which bundles the graph from `main.js` into a single
obfuscated `dist/js/app.js` (`<script type="module" src="/js/app.js">`) so the
deployed app is not its own source listing.

---

## 2. Data Model

> **Default (Supabase/Postgres):** the canonical data model is in
> [DATABASE-SUPABASE.md](DATABASE-SUPABASE.md) — UUID keys, per-user
> ownership under RLS, a generated `tsvector` search column, and the
> `profiles` / `user_roles` RBAC tables. The two content domains (`entries`,
> `prompts`) carry the same columns described below; the differences are
> engine-level (UUID vs INTEGER keys, `jsonb` vs JSON-in-TEXT, RLS vs
> route-layer scoping).
>
> The section below documents the **testing backend's SQLite schema**
> (see also [DATABASE-LOCAL.md](DATABASE-LOCAL.md) for the auth tables). Both
> backends expose the identical row shapes to the frontend, so § 3–§ 4 read
> the same either way.

### Testing backend — SQLite (WAL mode)

### PRAGMAs applied at every connection open (`server/db.js`)

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous  = NORMAL;   -- safe with WAL, much faster
PRAGMA busy_timeout = 5000;     -- ride out checkpoint locks
PRAGMA foreign_keys = ON;
```

### Tables (post migration 002 — current schema)

```sql
CREATE TABLE entries (
  id          INTEGER PRIMARY KEY,
  title       TEXT    NOT NULL CHECK (length(trim(title)) > 0),
  body_md     TEXT    NOT NULL CHECK (length(trim(body_md)) > 0),
  summary     TEXT    NOT NULL DEFAULT '',
  label       TEXT    NOT NULL DEFAULT 'Uncategorized',
  sublabel    TEXT    DEFAULT NULL,
  tags        TEXT    NOT NULL DEFAULT '[]',   -- JSON array of strings
  fields      TEXT    NOT NULL DEFAULT '{}',   -- JSON object: user-defined name -> plain-text value
  urls        TEXT    NOT NULL DEFAULT '[]',   -- JSON array of strings
  created_at  INTEGER NOT NULL,                -- UNIX ms; immutable (trigger below) — always server "now" on insert
  updated_at  INTEGER NOT NULL                 -- UNIX ms; auto-bumps to "now" on every save, but user-editable
                                                -- ("Modified" field) — also doubles as the optimistic-concurrency token
);

-- created_at immutability enforced in the DB, not just app code:
CREATE TRIGGER entries_created_at_immutable
BEFORE UPDATE OF created_at ON entries
WHEN new.created_at != old.created_at
BEGIN
  SELECT RAISE(ABORT, 'created_at is immutable');
END;

CREATE TABLE prompts (
  id             INTEGER PRIMARY KEY,
  title          TEXT    NOT NULL CHECK (length(trim(title)) > 0),
  category       TEXT    NOT NULL DEFAULT 'GENERAL',  -- all-caps group label
  body           TEXT    NOT NULL CHECK (length(trim(body)) > 0),  -- may contain {{Variables}}
  why_this_works TEXT    NOT NULL DEFAULT '',
  tags           TEXT    NOT NULL DEFAULT '[]',
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
```

`prompts` intentionally has **no** `fields` column and no editable-timestamp
support — the dynamic-metadata and manual-modified-time features only exist
on `entries` (the LogBook). Prompts are simpler by design: title, category,
body, why-it-works, tags.

### Full-text search (FTS5)

```sql
CREATE VIRTUAL TABLE entries_fts USING fts5(
  title, tags, summary, body_md, fields,
  content='entries', content_rowid='id', tokenize='porter unicode61'
);
-- AFTER INSERT / UPDATE / DELETE triggers keep entries_fts in sync.

CREATE VIRTUAL TABLE prompts_fts USING fts5(
  title, tags, category, body,
  content='prompts', content_rowid='id', tokenize='porter unicode61'
);
-- same trigger pattern.
```

`entries_fts` indexes the **`fields`** JSON blob as raw text — because
FTS5's tokenizer just splits on word boundaries, this means both field
*names* and field *values* are searchable (typing `macOS` finds an entry
with `os_platform: macOS`) without any special-casing in the search route.

Tags/labels are stored denormalized (JSON in-row) — correct for a
single-user tool; hierarchical Label → Sub-label needs no join table
because the hierarchy is only ever one level deep and is filtered
client-side after fetch.

### Migrations (`server/migrations/`, run by `server/db.js`)

Append-only, numbered, run inside a transaction, tracked in a
`schema_migrations` table so each runs exactly once:

| # | File | What it did |
|---|---|---|
| 001 | `001-init.sql` | Initial schema: `entries`, `prompts`, both `*_fts` tables + sync triggers |
| 002 | `002-dynamic-fields.sql` | Added `entries.fields`; **dropped** `entries.platform` and `entries.is_valid` (their values were not migrated — a deliberate product decision, not an oversight); rebuilt `entries_fts` to include `fields` (FTS5 can't `ALTER ... ADD COLUMN`, so the virtual table is dropped and recreated, then repopulated via `INSERT INTO entries_fts(entries_fts) VALUES('rebuild')`) |

If you're reproducing this project, **do not** try to add a `platform`
dropdown or `is_valid` checkbox back — see § 8.1 for why they were replaced
with the general-purpose `fields` model.

---

## 3. REST API Contract

> **Default (Supabase):** there is no bespoke REST server in production — the
> browser talks to Supabase directly through `supabase-js`, and `src/js/api.js`
> is a thin **adapter** that dispatches the same `api(path, { method, body })`
> calls to the SDK (PostgREST for data, GoTrue for auth). It preserves the
> exact response shapes, error codes, 409 optimistic-concurrency payload, and
> validation limits below, so `logbook.js` / `prompts.js` are unchanged. See
> [IMPLEMENTATION-SUPABASE.md](IMPLEMENTATION-SUPABASE.md).
>
> The contract below is the literal HTTP surface of the **testing backend's**
> Express API — and, equivalently, the shape the Supabase adapter emulates.

All bodies are JSON. All timestamps are UNIX milliseconds. Every entry/prompt
write response includes the row's new `updated_at` — the client sends it
back on the next `PUT` as `expected_updated_at` for stale-write detection.
Both backends additionally expose authentication + user management; those
endpoints differ per backend (Supabase Auth + Edge Functions vs the local
`/api/auth/*` and `/api/users/*` routes) and are documented in the two
`IMPLEMENTATION-*` specs.

| Method & path | Purpose | Notes |
|---|---|---|
| `GET /api/health` | Liveness + schema version | `{ ok, schema, now }` |
| `GET /api/entries?q=&tag=&label=` | List (FTS when `q` present) | Returns list-view fields only (title, summary, label, sublabel, tags, **fields**, created_at, updated_at) — no `body_md`, for a fast sidebar |
| `GET /api/entries/:id` | Full entry | Includes `body_md`, `urls`, `fields` |
| `POST /api/entries` | Create | 400 on blank title/body. Body may include `fields` (object) and an optional `updated_at` (number, UNIX ms) to set the initial Modified time explicitly — omit it and the server uses "now" |
| `PUT /api/entries/:id` | Update | Requires `expected_updated_at`; **409 Conflict** if the row is newer. Body may include `updated_at` to set Modified explicitly (manual override); omitted → server auto-bumps to "now". `created_at` is never accepted in the body — it cannot be set or changed via the API |
| `DELETE /api/entries/:id` | Delete | Client confirms first |
| `GET/POST/PUT/DELETE /api/prompts[...]` | Same CRUD shape as entries | No `fields`, no editable timestamps — see § 2 |
| `POST /api/import` | Markdown file → new entry | `.md`/`.markdown` only, ≤ 2 MB; title from first `# H1` or filename; see SECURITY.md § 4 |

Error envelope (uniform, from `server/errors.js`):
`{ "error": { "code": "CONFLICT", "message": "…" } }` with a matching HTTP
status — the frontend switches on `code`, not the message string.

### Validation limits (`server/validate.js`)

| Field | Limit |
|---|---|
| `title` | required, non-blank after trim, ≤ 300 chars |
| `body_md` / prompt `body` | required, non-blank after trim, ≤ 1 MB |
| `summary` / `why_this_works` | optional, ≤ 10,000 chars |
| `label` / `sublabel` | ≤ 128 chars; blank label → `"Uncategorized"` |
| `tags` | ≤ 32 tags, each ≤ 64 chars, comma-split-or-array accepted, trimmed, case-insensitive deduped |
| `urls` | ≤ 64 items, each ≤ 2048 chars, shape-only validated (validity/linkification is a client concern) |
| `fields` (entries only) | object only (not array — 400 if array), ≤ 64 entries, name ≤ 64 chars, value ≤ 2000 chars, case-insensitive deduped by name (first wins), any non-string/non-null value is stringified — **a nested object or array value is rejected with 400**, not silently flattened |
| `updated_at` (optional, entries only) | if present: must be a positive finite number — anything else (string, negative, `NaN`) → 400 |

---

## 4. Frontend Runtime Design

### Event bus (`bus.js`)

A single `new EventTarget()`. **Only 4 events actually exist** — this is
intentionally minimal; most cross-concern communication is direct function
calls (e.g. `logbook.js` calls its own `renderList()`, `setMode()`, etc.
directly — it does not round-trip through the bus for its own internal
state):

```
entry:dirty      { isDirty }   — logbook.js emits; main.js listens (tab dirty-dot)
entry:saved      { id, updated_at } — logbook.js emits; currently no listener (reserved for future cross-tab use)
tab:activate     { tabId }     — main.js emits on tab switch; currently no listener
theme:changed    { dark }      — main.js emits on theme toggle; logbook.js listens (re-themes Mermaid + re-renders preview)
```

If you're extending this app with a third tab/tool, prefer this same
pattern — publish on the bus only for things that genuinely cross module
boundaries, and reach for a direct function call for everything else.

### Render pipeline (`render.js`) — the single choke point

```
raw markdown
  → markdown-it, html:false  (raw HTML in markdown is escaped, not passed through)
    + a custom inline rule that whitelists bare <sup>/<sub> tags only
      (see § below and SECURITY.md § 2 — this is NOT the ^text^/~text~
      markdown-it extension syntax)
  → transformTaskLists()      "- [ ] x" / "- [x] x" → disabled <input type=checkbox>
  → transformAlerts()          blockquotes starting with ✅/ℹ️/⚠️ get .alert-* classes
  → KaTeX renderMathInElement  ($…$, $$…$$; ignores <pre>/<code>; per-call try/catch)
  → Mermaid render (per-fence async, try/catch → localized error chip on failure)
    → collapseForeignObjectLabels()  strips Mermaid's <foreignObject> labels,
       replacing each with a plain <text> built from .textContent only —
       see SECURITY.md § 2 for why this exists (Mermaid always emits
       foreignObject for labels; DOMPurify correctly refuses to sanitize
       inside one, so this hand-rolled, provably-inert extraction is what
       makes diagram text visible at all)
  → DOMPurify.sanitize(host.innerHTML, PURIFY_CONFIG)   LAST — sees final HTML
  → mount (renderInto(el, source) sets el.innerHTML to the sanitized string)
```

Exactly one function (`renderMarkdown` / its `renderInto` wrapper) ever
turns user text into DOM. Nothing else in the codebase calls `innerHTML`
with content derived from user input — this is a grep-enforced invariant
(see SECURITY.md § 6). Full DOMPurify config: SECURITY.md § 2.

### Reading / Editor mode (`logbook.js`, `#lb-workspace[data-mode]`)

Notes open in **Reading mode** by default — the rendered preview only, at a
constrained ~46rem reading measure, with the Summary section, Body header,
ribbon, editor pane, and divider all hidden via
`#lb-workspace[data-mode="read"] … { display: none !important }`. A single
icon button (`#lb-mode-toggle`) switches to **Editor mode** (the normal
split editor/preview); the icon swaps (open-book ↔ pencil) and its `title`
attribute carries the hover label — no separate tooltip library.

Defaults by entry-point (`setMode()` calls in `logbook.js`):

| Action | Mode |
|---|---|
| Open an existing entry (`openEntry`) | `read` |
| "New Entry" (`newEntry`) | `edit` |
| Markdown import (`importFile`) | `read` (review what was imported) |
| Restore an unsaved draft on boot | `edit` |
| Decline a draft restore (server version loads instead) | `read` |

### Dynamic metadata fields (`entries.fields`, TiddlyWiki-style)

Replaces what was originally planned as a fixed OS-Platform dropdown +
`isValid` checkbox (see § 8.1 for why). The metadata panel renders one row
per field (`name: [value input] [🗑]`) plus an "add a new field" row
(name input with a `<datalist>` of names already used on *other* entries,
value input, Add button). Client state is a `Map` (insertion-ordered);
`collectForm()` sends `Object.fromEntries(state.fields)` on save.
Server-side normalization: `server/validate.js` → `normalizeFields()`
(limits in § 3 table above).

### Prompt variable engine (`prompts.js`) — inline editing, no toggle

Variables are `{{Name}}` placeholders, grammar
`\{\{\s*([^{}]+?)\s*\}\}` (single scan, non-greedy, no recursion —
`parseVars()`). **There is no "Fill In and Copy" toggle button** and no
separate list of `<input>` elements below the card (an earlier iteration had
this; it was replaced). Instead, `buildEditableBody()` renders each
`{{Name}}` occurrence as an inline `contenteditable` `<span class="var-slot">`
directly inside the monospace prompt body:

- First **focus** on a slot selects its entire contents (`Range` +
  `Selection`), so typing immediately replaces the placeholder — same feel
  as a normal form field.
- **Duplicate occurrences** of the same variable name mirror each other's
  text live on every `input` event, except the slot currently focused
  (never steal its own caret).
- **Enter** is blocked inside a slot (`keydown` → `preventDefault`) — values
  stay single-line.
- **Paste** is forced to plain text (`clipboardData.getData('text/plain')`
  + `document.execCommand('insertText', …)`) so rich-text paste can't leave
  stray formatting nodes inside a slot.
- **Blur with empty content** reverts the slot's text back to the literal
  placeholder (`{{Name}}`) and deletes it from the values map — clearing a
  field never means "copy blank," it means "copy the placeholder."
- **Copy** always calls `composeBody(p.body, fillValues)`, which substitutes
  only variables present (and non-empty) in the values map — untouched
  variables copy as their literal `{{Name}}` text.

This whole engine has no dependency on the editor/reading-mode split above —
Prompt Library is a separate tab with its own always-editable cards.

### Autosave (`logbook.js`)

- `setInterval` 10 s; `writeDraft()` snapshots `{entryId|null, title,
  body_md, …all form fields…, _modified, _modifiedEdited, savedAt}` to
  `localStorage['bento.draft.v1']` **only when dirty** (skip idle ticks).
  `_modified`/`_modifiedEdited` preserve a hand-edited Modified-time value
  across a crash/restore.
- Cleared on successful server save (inside the save promise, not the tick,
  so a tick firing mid-save can't race the clear). Restore flow on boot:
  EDGE-CASES.md § 2.

### Focus-sync listener (`logbook.js`)

`window.addEventListener('focus', onWindowFocus)` → refetch list + open
entry **unless** the editor is dirty (never clobber unsaved work — shows a
banner instead, offering Review/Keep-mine). Debounced 30 s.

---

## 5. Build Phases — Phase 1 (original scope, complete)

| Phase | Scope | Exit criteria |
|---|---|---|
| **A — Scaffold** | package.json, Tailwind CLI pipeline, Express static+health, db.js with PRAGMAs + migration 001, bus.js | `npm run dev` serves shell page; `/api/health` returns schema version |
| **B — Docs LogBook** | Entries CRUD, sidebar + FTS search, editor/preview split, ribbon, syntax cheat-sheet, render pipeline, autosave, guards | Every EDGE-CASES.md LogBook row demonstrably handled |
| **C — Prompt Library** | Prompts CRUD, search + pill filters, category groups, cards, `{{var}}` engine, card back | Every EDGE-CASES.md Prompts row handled |
| **D — Security hardening** | CSP + headers, import limits, DOMPurify config audit vs SECURITY.md | Zero findings on the SECURITY.md checklist |
| **E — UX polish** | Traffic lights, dock, Focus Mode, transitions, a11y pass, empty states (informed by the `ui-ux-pro-max` skill's design-system output) | UX-SPEC.md acceptance checklist green |

All five phases are done and verified (see the test suites referenced in
each companion doc). What follows in § 8 was built afterward, iteratively,
in response to direct feature requests — each item there is a completed
increment, not a plan.

## 6. Deployment

### Default — Supabase (production)

1. Provision the Supabase project, push `supabase/migrations/`, deploy the
   Edge Functions, bootstrap the global admin, and (optionally) migrate any
   local `bento.db` data across — the full runbook is
   [IMPLEMENTATION-SUPABASE.md](IMPLEMENTATION-SUPABASE.md) § 2–§ 4.
2. Serve the static `dist/` from Express (or any static host/CDN). When using
   Express, set `BENTO_SUPABASE_URL` so the CSP `connect-src` allowlist names
   the project origin exactly. The host owns no data; all reads/writes go
   browser → Supabase under RLS.
3. Config lives in `src/js/supabase-config.js` (project URL + anon key — safe
   to ship; RLS is the guard). The service-role key is never in `src/`.

### Testing — local SQLite over Tailscale (offline dev)

1. Express listens on `127.0.0.1:3000` — **never** `0.0.0.0`. The app is
   unreachable even on the LAN except through Tailscale.
2. `tailscale serve --bg https / http://127.0.0.1:3000` exposes it at
   `https://<machine>.<tailnet>.ts.net` with an automatic valid TLS cert.
   HTTPS is functionally required: the async Clipboard API (Prompt
   Library's core "Copy" action, and the LogBook's own copy fallback path)
   only exists in secure contexts.
3. No funnel, no port-forward, no public exposure — access list is the tailnet.
4. `bento.db*` (db + `-wal` + `-shm`) lives in `data/`, outside `dist/`;
   backup guidance in SECURITY.md § 5.

### Both

Runtime libraries are **vendored, not CDN-loaded** (CSP forbids it):
`scripts/copy-vendor.js` copies `markdown-it`, `dompurify`, `katex` + its
`contrib/auto-render` addon, `mermaid` (and, on the Supabase backend,
`supabase-js`) from `node_modules` into `dist/vendor/` at build time.

## 7. Skill Map for the Build

| When | Skill | Why |
|---|---|---|
| UI-building steps | `ui-ux-pro-max` | Its domain is exactly this design language: bento grid, glassmorphism, dark mode, responsive |
| Any published plan/report page | `artifact-design` | Required before using the Artifact tool |
| Security-sensitive changes | `security-review` | Automated pass over pending changes |
| After any nontrivial change | `verify` | Drive the real app end-to-end (this project also has hand-written Playwright suites — see EDGE-CASES.md footer) |
| Optional polish passes | `impeccable`, `frontend-design` | Micro-interaction & aesthetic refinement |

## 8. Build History — post-Phase-1 additions

Chronological record of what was added after the original five phases
shipped, kept here so a reproduction doesn't have to reverse-engineer *why*
the code looks the way it does from git history alone.

### 8.1 Dynamic metadata fields (replaced OS Platform / isValid)

The original plan (mirroring PROJECT-BRIEF.md's "customizable OS Platform
dropdown, and boolean tracking properties like `isValid`") hardcoded exactly
two metadata properties. The user wanted arbitrary user-defined
name/value metadata instead (TiddlyWiki-style), so migration 002 replaced
both columns with a single `fields` JSON object. **The old values were
intentionally not migrated** — existing `platform`/`is_valid` data was
dropped, not converted, per an explicit product decision at the time.
See § 2 and § 4 above for the resulting shape.

### 8.2 Prompt variable engine rework (removed the "Fill In and Copy" toggle)

PROJECT-BRIEF.md originally specified: *"Toggling 'Fill In and Copy'
dynamically generates temporary inline input text fields matching those
variables directly on the card."* That was built, then replaced: the user
wanted to edit placeholders **directly in place** in the prompt text rather
than via a toggle + separate input list. See § 4's "Prompt variable engine"
above for the current (and only) behavior. If reproducing this project from
the brief alone, build the version described in this doc, not the literal
brief text — this doc supersedes it here. A revised brief that matches the
current build exists at [../PROJECT-BRIEF-updated.md](../PROJECT-BRIEF-updated.md);
the original [../PROJECT-BRIEF.md](../PROJECT-BRIEF.md) is kept as-is for
history.

### 8.3 Editable Modified time

`entries.updated_at` — previously purely server-managed — became editable.
`created_at` remains fully immutable (DB trigger unchanged). A manually-set
Modified time is sent verbatim; omitting it lets the server auto-bump to
"now" as before. Because `updated_at` also doubles as the optimistic-
concurrency token, the client always reads the token from in-memory state
(`state.current.updated_at`, full ms precision) — never reconstructed from
the second-precision `<input type="datetime-local">` field — so editable
Modified time does not weaken conflict detection.

### 8.4 Superscript, subscript, bulleted list, numbered list ribbon buttons

Added to the LogBook formatting ribbon. Bulleted/numbered lists are
ordinary CommonMark (`- item` / `1. item`) via a new `prefixLines()` ribbon
helper that prefixes every line in the current selection. Superscript and
subscript are **not** the markdown-it `^text^`/`~text~` extension syntax —
that was deliberately rejected because `^` is how KaTeX writes exponents
inside `$…$`, and using it for superscript would silently corrupt math like
`$a^2+b^2$`. Instead they use literal `<sup>`/`<sub>` HTML tags, made safe
by a narrow custom markdown-it inline rule (see § 4 and SECURITY.md § 2).

### 8.5 Reading / Editor mode toggle

See § 4 above. Added because notes were always opening directly into the
editor, which is wrong for the common case of just wanting to *read* a
note.

### 8.6 Two production bugs found and fixed in the render pipeline

Both are documented in full in SECURITY.md § 2 because they're security-
pipeline lessons, not just bugs — a naive reproduction is likely to
reintroduce them:

1. A custom `ALLOWED_URI_REGEXP` on the DOMPurify config (meant to belt-
   and-suspenders block `javascript:`/`data:` links) was **removed** —
   it was redundant with DOMPurify's own vetted default regex, and it was
   actively harmful: it silently stripped non-URI attributes like SVG's
   `viewBox` and `width="100%"`, which blanked every Mermaid diagram to a
   zero-size box.
2. `collapseForeignObjectLabels()` was added because Mermaid always renders
   node/edge labels inside `<foreignObject>` (regardless of
   `securityLevel: 'strict'` or `flowchart.htmlLabels: false`), and
   DOMPurify — correctly — empties `foreignObject` content wholesale rather
   than trying to partially sanitize inside it. Without this function every
   diagram rendered as empty shapes with no visible text.

### 8.7 Standalone git repository + branching workflow

BentoOS was extracted into its own git repository (it previously had none
of its own — the enclosing directory's `.git` was rooted at the user's home
directory, which was **not** used to avoid sweeping in unrelated files).
Workflow going forward: every feature/fix gets its own branch off `dev`,
merged into `dev` first (`--no-ff`, so the merge is a visible event);
promotion from `dev` to `main` is a separate, deliberate step. `main` holds
only the Phase 1 initial commit as of this writing.

### 8.8 Supabase became the default backend; multi-user auth + RBAC

The app moved from single-user/no-auth to **multi-user with authentication,
RBAC, and per-user isolation**, and **Supabase (PostgreSQL + Auth) is now the
default/production backend** — the browser talks to it directly via
`supabase-js` under Row-Level Security; Express is reduced to a static host.
The frontend's `api()` layer became a backend adapter so `logbook.js` /
`prompts.js` were untouched. The original **local SQLite + Express** stack was
kept and extended into a full auth backend (server-side sessions, scrypt,
route-layer scoping) that now serves as the **testing/offline variant**.

Both backends implement the same RBAC model — one global admin
(`admin`/`bentoos`, forced password change on first login), standard admins
who reset normal-user passwords, and normal users scoped to their own data —
and the same GDPR/PDPA hard-delete guarantee. The two are documented in the
matched set: [IMPLEMENTATION-SUPABASE.md](IMPLEMENTATION-SUPABASE.md) /
[DATABASE-SUPABASE.md](DATABASE-SUPABASE.md) (default) and
[IMPLEMENTATION-LOCAL.md](IMPLEMENTATION-LOCAL.md) /
[DATABASE-LOCAL.md](DATABASE-LOCAL.md) (testing). Branch layout: the Supabase
variant lives on `main` (and `dev-supabase`); the local-auth variant on
`dev-local-auth`.

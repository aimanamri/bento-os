# Bento OS 🍱

A personal knowledge base, prompt library, and code-snippet vault in one
macOS-style window. Vanilla JS + Tailwind on the front, **Supabase
(PostgreSQL + Auth)** on the back — the browser talks to Supabase directly,
so the Node server here only serves static files. Multi-user with RBAC,
Row-Level Security, and GDPR/PDPA hard deletes.

- **No framework.** ES modules, a tiny event bus, no build-time magic beyond
  esbuild + Tailwind.
- **No data layer in the server.** Express serves `dist/` and sets CSP
  headers. That's it. Your data lives in your Supabase project.
- **Runs anywhere you can open a browser.** Localhost, a Docker container, or
  over Tailscale from your phone. It installs as a PWA and opens offline.

---

## What's inside

The window has three tabs, and every record is owned by exactly one user.

### 📓 Docs LogBook
Long-form markdown notes — post-mortems, guides, troubleshooting logs.

- **Reading / Editor modes.** Existing notes open as clean rendered prose;
  new notes open in the split editor/preview. One toggle switches them.
- **Rich rendering:** markdown-it → KaTeX (math) → Mermaid (diagrams) →
  Prism (syntax highlighting) → DOMPurify. Click a fenced code block to copy it.
- **Sticky formatting ribbon:** headings, code blocks, tables, checkboxes,
  lists, super/subscript, and pre-styled success/info/warning alert blocks.
- **Dynamic metadata fields** (TiddlyWiki-style key/value pairs), labels,
  sub-labels, tags, a summary block, collapsible URL lists, and an editable
  Modified time.
- **Sidebar** with full-text search across title, tags, fields, summary and
  body, plus group-by and tag-filter pills.
- **Autosave to localStorage every 10 s** while editing, with a restore
  prompt after a crash or refresh, and a 409 conflict guard so a second tab
  can never silently clobber your work.

### 💬 Prompt Library
Reusable AI prompt templates, grouped by category.

- Cards with a monospace body, search, and tag-filter pills.
- **`{{Variable}}` fill-in engine** — type into the inline fields the
  template generates and the copy buffer updates live. One click copies the
  composed prompt.

### 🧩 Code Snippets
The same shape as the Prompt Library, tuned for commands and code.

- Language/tool categories get a deterministic color accent (no hardcoded
  palette to maintain), syntax highlighting, card flip for notes, and the
  same `{{Variable}}` fill-in engine.

### The window itself
Real traffic lights: 🔴 minimizes the tool to a dock pill (state preserved),
🟡 toggles Focus Mode (`⌘.` / `Ctrl+.`), 🟢 goes fullscreen. `⌘S` / `Ctrl+S`
saves. Dark-first, with a light variant, and everything honors
`prefers-reduced-motion`.

---

## Quick start

**Prerequisites:** Node 20 (what the Docker images build and run on), a
Supabase project, and the
[Supabase CLI](https://supabase.com/docs/guides/cli).

1. **Create the backend.** Follow
   [docs/SUPABASE-MIGRATION.md](docs/SUPABASE-MIGRATION.md): create the
   project, `supabase db push` the migrations in [supabase/migrations/](supabase/migrations/),
   deploy the Edge Functions, then fill in your project URL and **anon** key
   in [src/js/supabase-config.js](src/js/supabase-config.js).

2. **Bootstrap the first admin** (username `admin`, password `bentoos` — a
   password change is forced on first login):
   ```bash
   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run setup:admin
   ```

3. **Run it.**
   ```bash
   npm install
   npm run dev        # build CSS/static/vendor/JS/SW, then start the host
   ```
   Open **http://127.0.0.1:3000**.

4. *(Optional)* **Import an existing local SQLite database:**
   ```bash
   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run migrate:data
   ```

> The service-role key is only ever used by these one-off admin scripts from
> your shell. It must never land in the repo, the bundle, or an image.

### Server environment

| Variable | Default | Purpose |
|---|---|---|
| `BENTO_PORT` | `3000` | Listening port |
| `BENTO_HOST` | `127.0.0.1` | Bind address — loopback only, deliberately ([docs/SECURITY.md](docs/SECURITY.md) §4) |
| `BENTO_SUPABASE_URL` | (from config) | Pins the CSP `connect-src` allowlist to your exact project origin |

`npm start` skips the build and just starts the server.

---

## Running with Docker

The container is **stateless** — no volumes, no database, nothing to migrate
between machines:

```bash
docker compose up -d      # → http://127.0.0.1:8481
```

The production image is non-root, read-only, `cap_drop: ALL`, with a
healthcheck. Because `supabase-config.js` is compiled into `dist/` at build
time, pointing a deployment at a different Supabase project requires
`docker compose up -d --build`, not just a restart. Full details in
[DOCKER.md](DOCKER.md).

---

## Install it as an app (PWA)

Bento OS ships a manifest and a service worker, so it installs to the
dock/home screen and launches in its own window: **Install Bento OS…** in the
account menu, the browser's own install control, or *Share → Add to Home
Screen* on iOS.

The service worker precaches the app shell — HTML, CSS, JS, vendored render
libraries — so an installed Bento OS **opens offline** instead of showing a
browser error. It caches the *application* only: your entries, prompts and
snippets live in Supabase and still need connectivity, so offline you get the
workspace with an *offline* chip and empty lists. That split is intentional
([docs/SECURITY.md](docs/SECURITY.md) §4a).

Registration needs a secure context — `localhost`, or the HTTPS Tailscale
serve below. Over plain-HTTP LAN the app runs online-only. Regenerate icons
with `npm run icons` after changing the mark.

---

## Remote access (Tailscale)

```bash
tailscale serve --bg https / http://127.0.0.1:3000
```

Then open `https://<machine>.<tailnet>.ts.net` from any tailnet device. HTTPS
matters: the copy buttons use the async Clipboard API, which only exists in
secure contexts (there's a manual-copy fallback otherwise).

---

## Accounts, roles & data

- **Sign-in is User ID + password** (Supabase Auth).
- **Three roles:** `global_admin` (exactly one, enforced by a partial unique
  index), `admin`, and `user`. Admins create users, reset passwords to the
  default, and delete accounts — via service-role Edge Functions, since
  `user_roles` has no client write path at all, making self-elevation
  impossible.
- **Admins cannot read your content.** `entries`, `prompts` and `snippets`
  are owner-only under RLS with no admin policy — the blindness is
  structural, not a UI choice.
- **Account deletion is a hard delete** (GDPR/PDPA): account, entries,
  prompts and snippets are permanently erased.
- **Backups** are Supabase's scheduled backups / PITR. The legacy
  `data/bento.db` file is only read by `npm run migrate:data`.

See [docs/DATABASE.md](docs/DATABASE.md) for the ER diagram, RLS matrix, and
full-text-search weights.

---

## Repository layout

```
server/          Static file host (Express) + CSP headers — no data layer
supabase/        SQL migrations + Edge Functions (admin user CRUD, delete-account)
src/             Frontend source
  index.html       The whole window: tabs, dialogs, ribbon
  css/input.css    Tailwind entry + design tokens
  js/              ES modules — see below
  sw.js            Service worker (app-shell precache)
scripts/         Build helpers, admin bootstrap, SQLite→Supabase migration
dist/            Build output (generated; served by Express)
docs/            Implementation plan, security, database, UX, edge cases
```

Key modules in `src/js/`: [api.js](src/js/api.js) (every Supabase call,
normalized), [logbook.js](src/js/logbook.js), [prompts.js](src/js/prompts.js),
[snippets.js](src/js/snippets.js), [render.js](src/js/render.js) (the single
XSS-safe render choke point), [vars.js](src/js/vars.js) (the `{{Variable}}`
engine shared by prompts and snippets), [bus.js](src/js/bus.js) (event bus),
[auth.js](src/js/auth.js), [ui.js](src/js/ui.js) (toasts + confirm modals).

---

## Build

| Script | What it does |
|---|---|
| `npm run dev` | Full build, then start the server |
| `npm run build` | CSS → static → vendor → JS → service worker |
| `npm run build:readable` | Same, unobfuscated, with an inline source map |
| `npm run icons` | Regenerate the PWA icon set |
| `npm run setup:admin` | Create/repair the global admin |
| `npm run migrate:data` | Import a local SQLite database into Supabase |

`npm run build` bundles everything under `src/js/` into a single obfuscated
`dist/js/app.js` — readable modules are never copied into `dist/`, so the
deployed app doesn't double as its own source listing. **Never deploy
`build:readable`** (or `BENTO_OBFUSCATE=0`): its source map contains the full
source. Obfuscation raises the cost of reading the client; it is *not* a
security control — the Supabase URL and anon key travel with every request,
and RLS is what actually protects the data.

The render libraries (markdown-it, KaTeX, Mermaid, DOMPurify, Prism) and
supabase-js are vendored into `dist/vendor/` at build time — the CSP forbids
CDNs by design. Prism is assembled from its core plus the grammars listed in
[scripts/copy-vendor.js](scripts/copy-vendor.js); add a language by adding
its name there.

---

## Two backends, one frontend

| | Branch | Backend |
|---|---|---|
| **Default / production** | `main` | Supabase (PostgreSQL + Auth), accessed from the browser |
| **Offline dev / testing** | `dev-local-auth` | Local SQLite (WAL) + Express REST API |

Both share the same frontend, RBAC model, and GDPR guarantees. Each design is
documented side by side:
[IMPLEMENTATION-SUPABASE.md](docs/IMPLEMENTATION-SUPABASE.md) /
[DATABASE-SUPABASE.md](docs/DATABASE-SUPABASE.md) versus
[IMPLEMENTATION-LOCAL.md](docs/IMPLEMENTATION-LOCAL.md) /
[DATABASE-LOCAL.md](docs/DATABASE-LOCAL.md).

---

## Documentation map

| Document | Read it for |
|---|---|
| [PROJECT-BRIEF.md](PROJECT-BRIEF.md) | The original vision and feature spec |
| [docs/IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md) | Architecture overview, runtime design, build history |
| [docs/UX-SPEC.md](docs/UX-SPEC.md) | Design tokens, layouts, accessibility acceptance criteria |
| [docs/DATABASE.md](docs/DATABASE.md) | ER diagram, RLS policies, FTS, triggers |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model, render pipeline, hardening, audit checklist |
| [docs/EDGE-CASES.md](docs/EDGE-CASES.md) | Behavior under conflicts, offline, reduced motion, empty states |
| [DOCKER.md](DOCKER.md) | Container images, compose, hardening, moving machines |

## Testing

API and UI test suites live in the session scratchpad during development; the
security audit checklist is in [docs/SECURITY.md](docs/SECURITY.md) §6.

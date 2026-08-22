# Bento OS 🍱

A personal knowledge base, prompt library and code-snippet vault in one
macOS-style window. Vanilla JS + Tailwind, no framework, installable as an app
and reachable from anywhere over Tailscale.

<!-- variant:supabase -->
> [!NOTE]
> **Backend: Supabase (PostgreSQL + Auth).** This is the default and the
> production target — the browser talks to Supabase directly, and the Node
> server here only serves static files. A functionally identical build backed
> by **local SQLite + Express** lives on the
> [`dev-local-auth`](../../tree/dev-local-auth) branch: same frontend, same
> RBAC model, same GDPR guarantees, no cloud account required.
<!-- /variant -->

![Bento OS — the LogBook in reading mode](docs/images/hero-logbook.png)

<!-- Screenshots live in docs/images/ and are shared by both branches — the UI
     is identical on each. -->
<table>
<tr>
<td width="50%"><img src="docs/images/hero-prompt_library.png" alt="Bento OS — the Prompt Library"></td>
<td width="50%"><img src="docs/images/hero-code_snippet.png" alt="Bento OS — Code Snippets"></td>
</tr>
</table>

---

## What's inside

Three tools in one window. Every record belongs to exactly one account.

### 📓 Docs LogBook

Long-form markdown notes — guides, write-ups, and the fix you'll want again in
eight months.

- **Reading and Editor modes.** Notes open as clean rendered prose at a
  comfortable measure; one toggle switches to the split editor.
- **Rich rendering:** markdown-it → KaTeX (math) → Mermaid (diagrams) → Prism
  (28 languages) → DOMPurify. Click any code block to copy it.
- **Your own metadata fields**, labels, sub-labels, tags, a summary block,
  collapsible URL lists and an editable Modified time.
- **One search** across titles, tags, custom fields, summary and body, plus
  group-by and tag-filter pills.
- **Autosaves every 10 seconds** while you type, with a restore prompt after a
  crash, and a conflict guard so a second tab can't silently overwrite you.

### 💬 Prompt Library

The prompts you keep rewriting, saved once and grouped by category.

- Cards with a monospace body, search and tag-filter pills.
- **`{{Variable}}` blanks** you fill in on the card itself — the copy buffer
  updates as you type, and one click copies the finished text.
- **"Why this works"** takes markdown, rendered through the same sanitised
  pipeline as the LogBook.

### 🧩 Code Snippets

Commands and code you'd rather not look up twice.

- Language and tool categories get a deterministic colour accent — no palette
  to configure.
- Syntax highlighting, the same `{{Variable}}` engine, and **markdown Notes**
  on the back of each card.

### The window itself

Real traffic lights: 🔴 minimises the tool to a dock pill with its state
intact, 🟡 toggles Focus Mode (`⌘.` / `Ctrl+.`), 🟢 goes fullscreen. `⌘S`
saves. Signing in happens on a lock screen with a face card that reacts to
whether you got the password right. Dark-first, with a light variant and a
toggle that follows your device until you choose otherwise; everything honours
`prefers-reduced-motion`.

---

<!-- variant:supabase -->
## How it fits together

```mermaid
flowchart LR
  E["Express<br/>static host + CSP headers"] -->|"app shell"| B["Browser<br/>vanilla JS + Tailwind"]
  B <-->|"every read and write<br/>supabase-js"| S["Supabase<br/>Postgres · Auth · Row-Level Security"]
```

The server has **no data layer**. It serves `dist/` and sets CSP headers; your
data lives in your Supabase project, which is what makes moving to another
machine trivial.

## Quick start

**Prerequisites:** Node 20, a Supabase project, and the
[Supabase CLI](https://supabase.com/docs/guides/cli).

1. **Create the backend.** Follow
   [docs/SUPABASE-MIGRATION.md](docs/SUPABASE-MIGRATION.md): create the project,
   `supabase db push` the migrations in [supabase/migrations/](supabase/migrations/),
   deploy the Edge Functions, then fill in your project URL and **anon** key in
   [src/js/supabase-config.js](src/js/supabase-config.js).

2. **Bootstrap the first admin** (username `admin`, password `bentoos` — a
   password change is forced at first sign-in):

   ```bash
   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run setup:admin
   ```

3. **Run it.**

   ```bash
   npm install
   npm run dev        # build, then serve on http://127.0.0.1:3000
   ```

4. *(Optional)* **Import an existing SQLite database:**

   ```bash
   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run migrate:data
   ```

> [!IMPORTANT]
> The anon key is safe to commit — every table is protected by Row-Level
> Security and the key grants nothing on its own. The `service_role` key is
> used only by those one-off admin scripts from your shell, and must never
> reach the repo or an image.

### Server environment

| Variable | Default | Purpose |
|---|---|---|
| `BENTO_PORT` | `3000` | Listening port |
| `BENTO_HOST` | `127.0.0.1` | Bind address — loopback only, deliberately ([SECURITY.md](docs/SECURITY.md) §4) |
| `BENTO_SUPABASE_URL` | from config | Pins the CSP `connect-src` allowlist to your exact project origin |

`npm start` skips the build and just starts the server.

## Running with Docker

The container is **stateless** — no volumes, no database, nothing to migrate
between machines:

```bash
docker compose up -d      # → http://127.0.0.1:8481
```

The production image is non-root, read-only, `cap_drop: ALL`, with a
healthcheck. Because `supabase-config.js` is compiled into `dist/` at build
time, pointing a deployment at a different project needs
`docker compose up -d --build`, not just a restart. Full details in
[DOCKER.md](DOCKER.md).
<!-- /variant -->

---

## Install it as an app (PWA)

Bento OS ships a manifest and a service worker, so it installs to the dock or
home screen and launches in its own window: **Install Bento OS…** in the
account menu, your browser's own install control, or *Share → Add to Home
Screen* on iOS.

The service worker precaches the app shell — HTML, CSS, JS and the vendored
render libraries — so an installed Bento OS **opens offline** instead of
showing a browser error. It caches the *application* only: your content still
needs connectivity, so offline you get the workspace with an *offline* chip and
empty lists. That split is deliberate ([SECURITY.md](docs/SECURITY.md) §4a).

Registration needs a secure context — `localhost`, or the HTTPS Tailscale serve
below. Over plain-HTTP LAN the app runs online-only. Regenerate icons with
`npm run icons` after changing the mark.

## Remote access (Tailscale)

```bash
tailscale serve --bg https / http://127.0.0.1:3000
```

Then open `https://<machine>.<tailnet>.ts.net` from any tailnet device. HTTPS
matters: the copy buttons use the async Clipboard API, which only exists in
secure contexts (there's a manual-copy fallback otherwise).

---

<!-- variant:supabase -->
## Accounts, roles & data

- **Sign-in is User ID + password** (Supabase Auth).
- **Three roles:** `global_admin` (exactly one, enforced by a partial unique
  index), `admin` and `user`. Admins create users, reset passwords and delete
  accounts through service-role Edge Functions; `user_roles` has no client
  write path at all, so self-elevation is impossible.
- **Admins cannot read your content.** `entries`, `prompts` and `snippets` are
  owner-only under RLS with no admin policy — the blindness is structural, not
  a UI choice. The admin panel shows usernames, roles and join dates only.
- **Account deletion is a hard delete** (GDPR/PDPA): the account and everything
  it owns are permanently erased.
- **Backups** are Supabase's scheduled backups / PITR. The legacy
  `data/bento.db` file is only read by `npm run migrate:data`.

See [docs/DATABASE.md](docs/DATABASE.md) for the ER diagram, RLS matrix and
full-text-search weights.

## Repository layout

```
server/          Static file host (Express) + CSP headers — no data layer
supabase/        SQL migrations + Edge Functions (admin user CRUD, delete-account)
src/             Frontend source
  index.html       The whole window: lock screen, tabs, dialogs, ribbon
  css/input.css    Tailwind entry + design tokens
  js/              ES modules — see below
  sw.js            Service worker (app-shell precache)
scripts/         Build helpers, admin bootstrap, SQLite→Supabase migration
dist/            Build output (generated; served by Express)
docs/            Implementation plan, security, database, UX, edge cases
```

## Build

| Script | What it does |
|---|---|
| `npm run dev` | Full build, then start the server |
| `npm run build` | CSS → static → vendor → JS → service worker |
| `npm run build:readable` | Same, unobfuscated, with an inline source map |
| `npm run icons` | Regenerate the PWA icon set |
| `npm run setup:admin` | Create or repair the global admin |
| `npm run migrate:data` | Import a local SQLite database into Supabase |

`npm run build` bundles everything under `src/js/` into a single obfuscated
`dist/js/app.js` — the readable modules are never copied into `dist/`, so the
deployed app doesn't double as its own source listing. **Never deploy
`build:readable`**: its source map contains the full source. Obfuscation raises
the cost of reading the client; it is *not* a security control — the Supabase
URL and anon key travel with every request, and RLS is what actually protects
the data.
<!-- /variant -->

The render libraries (markdown-it, KaTeX, Mermaid, DOMPurify, Prism) are
vendored into `dist/vendor/` at build time — the CSP forbids CDNs by design.
Prism is assembled from its core plus the grammars listed in
[scripts/copy-vendor.js](scripts/copy-vendor.js); add a language by adding its
name there.

Key modules in `src/js/`: [api.js](src/js/api.js) (every backend call,
normalised), [logbook.js](src/js/logbook.js), [prompts.js](src/js/prompts.js),
[snippets.js](src/js/snippets.js), [render.js](src/js/render.js) (the single
XSS-safe render choke point), [vars.js](src/js/vars.js) (the `{{Variable}}`
engine), [auth.js](src/js/auth.js) (lock screen, RBAC, admin panel),
[theme.js](src/js/theme.js), [tour.js](src/js/tour.js), [bus.js](src/js/bus.js).

---

## Two backends, one frontend

| | Branch | Backend |
|---|---|---|
| **Default / production** | `main` | Supabase (PostgreSQL + Auth), reached from the browser |
| **Offline dev / testing** | `dev-local-auth` | Local SQLite (WAL) + Express REST API |

Both share the same frontend, RBAC model and GDPR guarantees. The two designs
are documented side by side in
[IMPLEMENTATION-SUPABASE.md](docs/IMPLEMENTATION-SUPABASE.md) /
[DATABASE-SUPABASE.md](docs/DATABASE-SUPABASE.md) and
[IMPLEMENTATION-LOCAL.md](docs/IMPLEMENTATION-LOCAL.md) /
[DATABASE-LOCAL.md](docs/DATABASE-LOCAL.md).

<!-- variant:supabase -->
## Documentation map

| Document | Read it for |
|---|---|
| [PROJECT-BRIEF.md](PROJECT-BRIEF.md) | Current product vision and feature spec |
| [docs/IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md) | Architecture overview, runtime design, build history |
| [docs/UX-SPEC.md](docs/UX-SPEC.md) | Design tokens, layouts, accessibility acceptance criteria |
| [docs/DATABASE.md](docs/DATABASE.md) | ER diagram, RLS policies, FTS, triggers |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model, render pipeline, hardening, audit checklist |
| [docs/EDGE-CASES.md](docs/EDGE-CASES.md) | Behaviour under conflicts, offline, reduced motion, empty states |
| [docs/SUPABASE-MIGRATION.md](docs/SUPABASE-MIGRATION.md) | Standing the backend up from scratch |
| [DOCKER.md](DOCKER.md) | Container images, compose, hardening, moving machines |
<!-- /variant -->

## Testing

API and UI test suites live in the session scratchpad during development; the
security audit checklist is in [docs/SECURITY.md](docs/SECURITY.md) §6.

## License

[MIT](LICENSE) — use it, fork it, ship it.

The libraries vendored into `dist/vendor/` keep their own licences (all MIT,
except DOMPurify which is MPL-2.0 or Apache-2.0). The build stacks their notices
into `dist/vendor/LICENSES.txt`, so any copy of `dist/` carries the attribution
those licences require.

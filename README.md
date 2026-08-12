# Bento OS 🍱

Personal knowledge base and prompt library. Vanilla JS + Tailwind frontend,
**Supabase (PostgreSQL + Auth)** backend accessed directly via the supabase-js
SDK, macOS bento-glass UI. Multi-user with RBAC, Row-Level Security and
GDPR/PDPA hard-delete semantics. See [PROJECT-BRIEF.md](PROJECT-BRIEF.md) and
[docs/](docs/) for the full specification.

> **Backend:** Supabase is the **default/production** backend — this branch
> (`main`). A functionally equivalent **local SQLite + Express** backend, for
> offline development and testing, lives on the **`dev-local-auth`** branch.
> Both share the same frontend, RBAC model, and GDPR guarantees; the design
> of each is documented side by side in
> [docs/IMPLEMENTATION-SUPABASE.md](docs/IMPLEMENTATION-SUPABASE.md) /
> [docs/DATABASE-SUPABASE.md](docs/DATABASE-SUPABASE.md) (default) and
> [docs/IMPLEMENTATION-LOCAL.md](docs/IMPLEMENTATION-LOCAL.md) /
> [docs/DATABASE-LOCAL.md](docs/DATABASE-LOCAL.md) (testing). See
> [docs/IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md) for the overview.

## Setup

1. Follow [docs/SUPABASE-MIGRATION.md](docs/SUPABASE-MIGRATION.md): create a
   Supabase project, `supabase db push`, deploy the Edge Functions, and fill
   in `src/js/supabase-config.js`.
2. Bootstrap the global admin (username `admin`, password `bentoos` — a
   password change is forced on first login):
   ```bash
   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run setup:admin
   ```
3. (Optional) migrate an existing local SQLite database:
   ```bash
   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run migrate:data
   ```

## Run

```bash
npm install
npm run dev        # builds CSS/static/vendor, then starts the static host
```

Open http://127.0.0.1:3000. The static host binds to loopback **only** — that
is deliberate (see [docs/SECURITY.md](docs/SECURITY.md) §4). Set
`BENTO_SUPABASE_URL=https://<ref>.supabase.co` so the CSP `connect-src`
allowlist is exact.

`npm start` skips the build and just starts the server.

### Build output

`npm run build` bundles everything under `src/js/` into a single obfuscated
`dist/js/app.js` — the readable modules are never copied into `dist/`, so the
deployed app doesn't double as its own source listing. For a debuggable build
with real names and an inline source map, run `npm run build:readable` (or set
`BENTO_OBFUSCATE=0`); never deploy that one — the source map contains the full
source. Obfuscation raises the cost of reading the client, but it is not a
security control: the Supabase URL and anon key still travel with every
request, and Row-Level Security remains what actually protects the data (see
[docs/SECURITY.md](docs/SECURITY.md)).

## Install it as an app (PWA)

Bento OS ships a web app manifest and a service worker, so it can be
installed to the dock/home screen and launched in its own window: open it in
the browser and choose **Install Bento OS…** from the account menu (or the
browser's own install control; on iOS, *Share → Add to Home Screen*).

The service worker precaches the app shell — HTML, CSS, JS and the vendored
render libraries — so an installed Bento OS **opens offline** instead of
showing a browser error. It caches the application only: your entries,
prompts and snippets live in Supabase and still need connectivity, so
offline you get the workspace with an *offline* chip and empty lists. See
[docs/SECURITY.md](docs/SECURITY.md) §4a for why the data layer is
deliberately never cached.

Registration needs a secure context — `localhost` in development, or the
HTTPS Tailscale serve below. Over plain-HTTP LAN the app runs online-only.
Regenerate the icon set with `npm run icons` after changing the mark.

## Remote access (Tailscale)

```bash
tailscale serve --bg https / http://127.0.0.1:3000
```

Then open `https://<machine>.<tailnet>.ts.net` from any tailnet device.
HTTPS matters: the Prompt Library's copy button uses the async Clipboard API,
which only exists in secure contexts (there is a manual-copy fallback otherwise).

## Data, auth & backups

- Data lives in Supabase Postgres; every table is RLS-protected (owner-only
  CRUD — see [docs/DATABASE.md](docs/DATABASE.md)).
- Sign-in is User ID + password (Supabase Auth). Admins can reset Normal User
  passwords to the default; users are then forced through a password change.
- Account deletion is a **hard delete** (GDPR/PDPA) — account, entries and
  prompts are permanently erased.
- Backups: use Supabase's scheduled backups / PITR. The legacy
  `data/bento.db` file is only read by `npm run migrate:data`.
- Drafts autosave to browser localStorage every 10 s while editing; you'll be
  offered a restore after a crash or refresh.

## Layout

```
server/          Static file host (Express) + CSP headers — no data layer
supabase/        SQL migrations, Edge Functions (deployed with the CLI)
src/             Frontend source (index.html, css/input.css, js/, sw.js, manifest)
scripts/         Build helpers, admin bootstrap, SQLite→Supabase migration
dist/            Build output (generated; served by Express)
docs/            Implementation plan, security spec, edge cases, UX, database
```

The rendering libraries (markdown-it, KaTeX, Mermaid, DOMPurify, Prism) and
supabase-js are vendored into `dist/vendor/` at build time — the CSP forbids
CDNs by design. Prism is assembled from its core plus the grammars listed in
`scripts/copy-vendor.js`; add a language by adding its name there.

## Testing

API and UI test suites live in the session scratchpad during development;
the security audit checklist is in [docs/SECURITY.md](docs/SECURITY.md) §6.

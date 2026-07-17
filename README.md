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
src/             Frontend source (index.html, css/input.css, js/)
scripts/         Build helpers, admin bootstrap, SQLite→Supabase migration
dist/            Build output (generated; served by Express)
docs/            Implementation plan, security spec, edge cases, UX, database
```

The rendering libraries (markdown-it, KaTeX, Mermaid, DOMPurify) and
supabase-js are vendored into `dist/vendor/` at build time — the CSP forbids
CDNs by design.

## Testing

API and UI test suites live in the session scratchpad during development;
the security audit checklist is in [docs/SECURITY.md](docs/SECURITY.md) §6.

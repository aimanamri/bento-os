# Bento OS — Implementation Plan (Supabase / cloud auth variant)

> Companion documents: [DATABASE-SUPABASE.md](DATABASE-SUPABASE.md) · [IMPLEMENTATION-LOCAL.md](IMPLEMENTATION-LOCAL.md) · [SECURITY.md](SECURITY.md) · [EDGE-CASES.md](EDGE-CASES.md)
> Base app (single-user, pre-auth): [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md)
>
> **Status: built** on the `main` / `dev-supabase` line. This document is the
> end-to-end runbook: project setup, schema push, RBAC bootstrap, data
> migration, and the compliance model. The local SQLite equivalent of the
> same feature set is [IMPLEMENTATION-LOCAL.md](IMPLEMENTATION-LOCAL.md).

---

## 1. Architecture

```
Browser (SPA, dist/)
  ├─ supabase-js (vendored UMD, CSP script-src 'self')
  │    ├─ Auth      → Supabase GoTrue (JWT, localStorage session)
  │    ├─ Data      → PostgREST  (entries / prompts under RLS)
  │    └─ Sensitive → Edge Functions (admin-reset-password, delete-account)
  └─ Express (server/index.js) — static file host + CSP headers ONLY
```

- The Express server no longer owns any data. `server/db.js`, the `/api`
  routes and the SQLite migrations were removed.
- `src/js/api.js` keeps the old `api(path, { method, body })` contract and
  dispatches to the Supabase SDK, so `logbook.js` / `prompts.js` are
  unchanged. Optimistic concurrency (409 + current row) is preserved via
  conditional `UPDATE … WHERE updated_at = expected`.
- Sessions: `supabase-js` stores the JWT in `localStorage` (pure SPA — no SSR
  cookie channel exists). The CSP (`script-src 'self'`, no inline) is the XSS
  backstop; tokens never appear in URL parameters
  (`detectSessionInUrl: false`).

## 2. One-time project setup

1. Create a project at [supabase.com](https://supabase.com) (or
   `supabase init && supabase start` for local development).
2. **Disable email confirmations** — usernames map to synthesized addresses
   (`<username>@bentoos.local`), which can't receive mail: Dashboard →
   Authentication → Sign In / Providers → Email → enable the provider, turn
   off *Confirm email*.
3. Push the schema:
   ```sh
   supabase link --project-ref <ref>
   supabase db push          # applies supabase/migrations/*.sql
   ```
4. Deploy the Edge Functions:
   ```sh
   supabase functions deploy admin-reset-password
   supabase functions deploy delete-account
   ```
5. Configure the frontend — edit `src/js/supabase-config.js`:
   ```js
   export const SUPABASE_URL = 'https://<ref>.supabase.co';
   export const SUPABASE_ANON_KEY = '<anon key>';
   ```
   The anon key is safe to ship: every table is RLS-protected.
6. (Static host CSP) When running the Express host, set
   `BENTO_SUPABASE_URL=https://<ref>.supabase.co` so `connect-src` is exact.

## 3. Bootstrap the Global Admin

```sh
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
npm run setup:admin
```

Creates the singleton superuser — username **`admin`**, password
**`bentoos`** — with `requires_password_change = true`. First login is
intercepted and routed to `#/change-password`; the dashboard is unreachable
(in the UI) until a new password is set. A partial unique index
(`one_global_admin`) makes a second global admin impossible at the DB level.

## 4. Migrate the SQLite data

```sh
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
BENTO_OWNER=admin \
npm run migrate:data
```

- Reads `data/bento.db` (override with `BENTO_DB=…`).
- Integer PKs are dropped; Postgres mints `gen_random_uuid()` UUIDs.
- `tags` / `fields` / `urls` TEXT-JSON columns become real `jsonb`.
- `created_at` / `updated_at` (UNIX ms bigints) carry over unchanged.
- FTS5 shadow tables are **not** migrated — the generated `search` tsvector
  column indexes rows on insert.
- Rows are assigned to `BENTO_OWNER` (the old DB was single-user).
- Re-runnable: rows already present upstream (same title + created_at) are
  skipped.

Afterwards verify in the app, then archive `data/bento.db` — nothing reads it
at runtime anymore.

## 5. RBAC model

| Capability | Global Admin (×1) | Admin | Normal User |
|---|---|---|---|
| Read/write **own** LogBook + prompts | ✅ | ✅ | ✅ |
| Read **other users'** LogBook data | ❌ (RLS) | ❌ (RLS) | ❌ (RLS) |
| See usernames + roles | ✅ | ✅ | own only |
| See emails / IPs / password hashes | ❌ | ❌ | ❌ |
| Reset a Normal User's password → `bentoos` | ✅ | ✅ | ❌ |
| Reset an admin's password | ❌ | ❌ | ❌ |
| Promote Normal User → admin | ✅ (RPC) | ❌ | ❌ |
| Delete own account (GDPR) | ❌ (singleton) | ✅ | ✅ |

Enforcement layers:

- **`user_roles`** has SELECT-only policies; no INSERT/UPDATE/DELETE policy,
  so a client can never write its own role (self-elevation is structurally
  impossible). Changes go through `SECURITY DEFINER` RPCs
  (`promote_to_admin`, `demote_to_user`, `mark_password_changed`) or the
  service-role Edge Functions.
- **Password reset** runs in the `admin-reset-password` Edge Function:
  verifies the caller's role, requires the target's role to be `user`, and
  applies custom rate limiting (5 resets/admin/hour, fail-closed) on top of
  Supabase Auth's built-in limits.
- **Data blindness**: admins query `profiles` (username only). Auth PII lives
  in the `auth` schema, unreadable by the anon/authenticated API roles;
  LogBook tables have owner-only RLS with no admin carve-out.

## 6. GDPR / PDPA

- **Right to be forgotten**: "Delete my account…" → `delete-account` Edge
  Function → `auth.admin.deleteUser()`. Every user-data FK is
  `ON DELETE CASCADE`, so erasure is a **hard delete** — no soft-delete flags.
- Entry/prompt deletion in the UI has always been a hard `DELETE`.
- Postgres `VACUUM` reclaims deleted tuples automatically; PITR backups age
  out per your retention setting — document that window in your privacy notice.

## 7. Column-level encryption for highly-sensitive PII

`pgcrypto` is enabled by the migration. For a column designated highly
sensitive (medical data, national IDs):

```sql
alter table public.entries add column sensitive_enc bytea;
-- write: pgp_sym_encrypt(value, key)   read: pgp_sym_decrypt(sensitive_enc, key)
```

Keep the key out of the DB (Edge Function secret via `supabase secrets set`,
wrapped in a `SECURITY DEFINER` accessor), or prefer Supabase Vault /
`pgsodium`. Do **not** feed encrypted columns into the generated `search`
tsvector.

## 8. Full-text search

FTS5 virtual tables + triggers are gone. Both tables carry a generated
`search tsvector` (weights in DATABASE-SUPABASE §5) with a GIN index, queried
via `sb.from('entries').textSearch('search', q, { type: 'websearch', config:
'english' })`. `websearch` parsing keeps user input literal — no MATCH-syntax
injection surface.

## 9. Auth & session rules

- Login is **User ID + password**; user IDs map to synthesized emails
  (`<id>@bentoos.local`) — change the domain in `src/js/supabase-config.js`
  *and* `scripts/setup-supabase-admin.js` together.
- Supabase built-in rate limiting covers sign-in/sign-up; custom fixed-window
  limits (`rate_limits` + `bump_rate_limit()`) cover the Edge Functions.
- `requires_password_change` is set on the bootstrapped global admin and
  whenever an admin resets a user's password. `auth.js` intercepts routing
  after sign-in and forces `#/change-password` before any data loads.

## 10. Forgotten passwords (recovery hierarchy)

Synthesized `@bentoos.local` addresses have no mailbox, so email recovery
can't work.

| Who forgot | Recovery path |
|---|---|
| Normal user | Any admin: User management → *Reset password* (in-app) |
| Standard admin | Global admin: *Remove admin* → *Reset password* → *Make admin* |
| Global admin | Service-role key holder: `node scripts/reset-user-password.js admin` |

The service-role key is the recovery root of trust; losing both it and the
global-admin password means regenerating keys via the Supabase Dashboard
(Settings → API), which project owners can always do.

## 11. Known gaps (from the code review)

Carried here so a future hardening pass doesn't rediscover them. Both are
enforced correctly by design in the **local** variant (IMPLEMENTATION-LOCAL
§4 / §11):

1. **`requires_password_change` is a client-side gate only** — no RLS policy
   checks it, so a valid JWT for a flagged account can read/write data by
   calling the REST API directly, bypassing `auth.js`. Close it with a
   trigger or a policy predicate on `user_roles.requires_password_change`.
2. **No server-side password policy** — GoTrue has no configured minimum
   length or default-password ban, so the UI's 8-char / no-`bentoos` rules
   are client-only. Set `minimum_password_length` and validate server-side.
3. **Tag filtering lost case-insensitivity** and **search lost BM25 ranking**
   in the SQL→PostgREST port (DATABASE-SUPABASE §5) — behavior regressions vs
   the SQLite original, not security issues.
4. **New users get no seed/onboarding content** (the old first-boot welcome
   entry + sample prompt aren't recreated per-user).
5. **`api.js` timeout doesn't cancel the request**, so a slow write that
   times out can still commit and a retry can duplicate it.

See the review record for the full ranked list and suggested fixes.

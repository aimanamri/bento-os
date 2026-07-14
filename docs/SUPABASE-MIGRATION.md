# Bento OS — Supabase Migration Runbook

> Companion documents: [DATABASE.md](DATABASE.md) · [SECURITY.md](SECURITY.md) · [EDGE-CASES.md](EDGE-CASES.md)

Bento OS moved from a local single-file SQLite database to **Supabase
(PostgreSQL + Auth)**, accessed directly from the browser through the
vendored `supabase-js` SDK. This document is the end-to-end runbook: project
setup, schema push, RBAC bootstrap, data migration, and the compliance model.

---

## 1. Architecture after the migration

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
2. **Disable email confirmations** — usernames are mapped to synthesized
   addresses (`<username>@bentoos.local`), which can't receive mail:
   Dashboard → Authentication → Sign In / Up → Email → turn off
   *Confirm email*.
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
**`bentoos`** — with `requires_password_change = true`. The first login is
intercepted and routed to the dedicated `#/change-password` view; the
dashboard is unreachable until a new password is set. A partial unique index
(`one_global_admin`) makes a second global admin impossible at the database
level.

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

Afterwards, verify in the app, then archive `data/bento.db` — nothing reads
it at runtime anymore.

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

- **`user_roles`** has SELECT-only policies; there is no INSERT/UPDATE/DELETE
  policy, so a client can never write its own role (self-elevation is
  structurally impossible). Changes happen through `SECURITY DEFINER` RPCs
  (`promote_to_admin`, `demote_to_user`, `mark_password_changed`) or the
  service-role Edge Functions.
- **Password reset** runs in the `admin-reset-password` Edge Function:
  verifies the caller's role, requires the target's role to be `user`, and
  applies custom rate limiting (5 resets/admin/hour, fail-closed) on top of
  Supabase Auth's built-in login/signup rate limits.
- **Data blindness**: admins query `profiles` (username only). Auth PII
  (emails, IPs, hashes) lives in the `auth` schema, which the anon/authenticated
  API roles cannot read; LogBook tables have owner-only RLS with no admin
  carve-out.

## 6. GDPR / PDPA

- **Right to be forgotten**: "Delete my account…" in the user menu calls the
  `delete-account` Edge Function → `auth.admin.deleteUser()`. Every FK from
  user data (`profiles`, `user_roles`, `entries`, `prompts`) is
  `ON DELETE CASCADE`, so the erasure is a **hard delete** — no soft-delete
  flags, no retained rows.
- Entry/prompt deletion in the UI has always been a hard `DELETE`; that is
  unchanged.
- Postgres `VACUUM` reclaims deleted tuples on Supabase automatically;
  point-in-time-recovery backups age out per your project's retention
  setting — document your retention window in your privacy notice.

## 7. Column-level encryption for highly-sensitive PII

`pgcrypto` is enabled by the migration. If a LogBook deployment designates a
column as highly sensitive (medical data, national IDs), store it encrypted
at rest:

```sql
alter table public.entries add column sensitive_enc bytea;
-- write: pgp_sym_encrypt(value, key)   read: pgp_sym_decrypt(sensitive_enc, key)
```

Keep the key out of the database (Edge Function secret via
`supabase secrets set`, wrapped in a `SECURITY DEFINER` accessor), or prefer
Supabase Vault / `pgsodium` for managed key storage. Do **not** feed
encrypted columns into the generated `search` tsvector.

## 8. Full-text search

The FTS5 virtual tables + trigger synchronization are gone. Both tables carry:

```sql
search tsvector generated always as (setweight(to_tsvector('english', …), 'A') || …) stored
```

with a GIN index, queried via the SDK:

```js
sb.from('entries').select(…).textSearch('search', q, { type: 'websearch', config: 'english' })
```

`websearch` parsing treats user input as literal terms — no query-language
injection surface (the old `ftsQuery()` quoting hack is no longer needed).

## 9. Auth & session rules

- Login is **User ID + password**; user IDs map to synthesized emails
  (`<id>@bentoos.local`) — change the domain in `src/js/supabase-config.js`
  *and* `scripts/setup-supabase-admin.js` together.
- Supabase built-in rate limiting covers sign-in/sign-up; custom
  fixed-window limits (backed by `public.rate_limits` +
  `bump_rate_limit()`) cover the Edge Functions.
- `requires_password_change` is set (a) on the freshly-bootstrapped global
  admin and (b) whenever an admin resets a user's password. `auth.js`
  intercepts routing after sign-in and forces the `#/change-password` view
  before any data loads.

## 10. Forgotten passwords (recovery hierarchy)

Synthesized `@bentoos.local` addresses have no mailbox, so email-based
recovery can never work. Recovery flows by role:

| Who forgot | Recovery path |
|---|---|
| Normal user | Any admin: User management → *Reset password* (in-app) |
| Standard admin | Global admin: *Remove admin* → *Reset password* → *Make admin* (in-app; the reset function only targets normal users by design) |
| Global admin | Service-role key holder only — break-glass script below |

```sh
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
node scripts/reset-user-password.js admin
```

Resets the password to the default and sets `requires_password_change`, so
the next login is forced through `#/change-password`. The service role key
is the recovery root of trust — losing *both* the global admin password and
the service role key means recovering via the Supabase Dashboard (Settings →
API → regenerate keys), which project owners can always do.

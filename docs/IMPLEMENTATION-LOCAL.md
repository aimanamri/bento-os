# Bento OS — Implementation Plan (Local / SQLite auth variant)

> Companion documents: [DATABASE-LOCAL.md](DATABASE-LOCAL.md) · [IMPLEMENTATION-SUPABASE.md](IMPLEMENTATION-SUPABASE.md) · [SECURITY.md](SECURITY.md) · [EDGE-CASES.md](EDGE-CASES.md) · [UX-SPEC.md](UX-SPEC.md)
> Base app (single-user, pre-auth): [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md)
>
> **Status: built**, on the `dev-local-auth` line (not `main`, which carries
> only the Supabase variant — see IMPLEMENTATION-PLAN.md § 8.8). It specifies
> the same login + user-management feature set the Supabase variant has
> ([IMPLEMENTATION-SUPABASE.md](IMPLEMENTATION-SUPABASE.md)) **while keeping
> the database local** — a single SQLite file owned by Express. Everything in
> the base app ([IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md)) stays; this
> layers auth, RBAC, and per-user data isolation on top. `dev-local-auth` has
> also picked up the Code Snippets tab and the pre-auth/theme/admin rebuilds
> described in IMPLEMENTATION-PLAN.md § 8.9–§ 8.14, and a partial i18n port
> (English + Japanese only — Bahasa Melayu, main-only so far, has not been
> ported here).

---

## 0. Design decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Where auth lives | Server-side, in Express | The server owns the DB; no external identity provider. This lets the forced-password-change gate and password policy be enforced at the API layer, not just the UI (fixes the two security gaps the Supabase variant's review flagged — see §11). |
| Session mechanism | Opaque session id in an **httpOnly, SameSite=Strict cookie**, backed by a `sessions` table | JS can't read the token, so XSS can't exfiltrate it; revocation/expiry is a row delete. Strictly better than a JS-readable JWT for a server that owns its own DB. |
| Password hashing | **Node `crypto.scrypt`** (memory-hard, in core) | Zero new dependencies, no extra native build beyond `better-sqlite3`. Stored as `scrypt$N$r$p$salt$hash`. |
| Per-user isolation | `WHERE user_id = ?` discipline in the route layer | SQLite has no RLS engine; scoping is enforced in code via shared helpers (§6). |
| Rate limiting | In-DB fixed-window counters (`rate_limits` table) | Single process, but survives restarts; no dependency on an external gateway. |

The two choices that were open questions — session model and hashing — were
confirmed with the maintainer before writing this plan.

## 1. Architecture

```
┌───────────────────────────── Laptop host ─────────────────────────────┐
│  Browser (any tailnet device)                                          │
│     │  HTTPS via `tailscale serve`;  httpOnly cookie carries session   │
│     ▼                                                                   │
│  Express.js  (127.0.0.1:3000 ONLY)                                      │
│     ├── static frontend  (dist/)                                        │
│     ├── /api/auth/*   login · logout · me · change-password · signup    │
│     ├── /api/users/*  admin: list · reset-pw · promote · demote         │
│     ├── /api/account  GDPR self-delete (hard)                           │
│     └── /api/entries · /api/prompts · /api/import  (now user-scoped)    │
│           │  middleware: requireAuth → requirePasswordChanged → role    │
│           ▼                                                             │
│  better-sqlite3 → bento.db  (users, sessions, rate_limits,             │
│                              entries+user_id, prompts+user_id)          │
└────────────────────────────────────────────────────────────────────────┘
```

No new runtime dependency: sessions, hashing, and rate limiting all use Node
core + `better-sqlite3`. `cookie` parsing is a ~20-line helper (or the tiny
`cookie` package if preferred — noted as optional).

## 2. New / changed files

```
server/
  password.js        # NEW — scrypt hash/verify (pure; no db dependency, so
                     #       db.js can hash the bootstrap admin without a cycle)
  auth.js            # NEW — session mint/verify/sweep, cookie helpers,
                     #       rate limiter, RBAC middleware
  db.js              # CHANGED — run migration 003; seed global admin (scrypt)
  validate.js        # CHANGED — username/password normalizers
  migrations/
    003-auth.sql     # NEW — users, sessions, rate_limits, user_id columns
  routes/
    auth.js          # NEW — /api/auth/*
    users.js         # NEW — /api/users/*, /api/account
    entries.js       # CHANGED — user_id scoping on every query
    prompts.js       # CHANGED — user_id scoping on every query
    import.js        # CHANGED — user_id on insert
  index.js           # CHANGED — cookie parse, mount auth/users, gate /api
src/
  index.html         # CHANGED — auth screen, user chip, admin dialog
  js/
    auth.js          # NEW — login portal, forced change-pw, user menu, admin panel
    api.js           # CHANGED — credentials + CSRF header; 401/403 handling
    main.js          # CHANGED — await auth gate before loading tools
scripts/
  reset-user-password.js  # NEW — break-glass CLI (global-admin recovery)
```

## 3. Authentication primitives (`server/password.js` + `server/auth.js`)

### Password hashing (scrypt) — `server/password.js`

```
hash(password):  salt = randomBytes(16); dk = scrypt(password, salt, 64, {N:16384,r:8,p:1})
                 return `scrypt$16384$8$1$${b64(salt)}$${b64(dk)}`
verify(password, stored):  re-derive with stored params/salt; timingSafeEqual(dk, stored dk)
```

All hashing is async (`scrypt`, not `scryptSync`) so it never blocks the
event loop. Verify is constant-time.

### Sessions

- **Mint** (on login / after password change): `token = randomBytes(32)`
  (base64url); insert `sha256(token)` as the `sessions.id` with
  `expires_at = now + 30d`. Set cookie:
  `bento_sid=<token>; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000` —
  plus `Secure` whenever the request arrived over HTTPS (behind
  `tailscale serve`) so the cookie is TLS-only in real deployments.
- **Verify** (middleware): read cookie → `sha256` → look up session JOIN user;
  reject if missing/expired. Slide `expires_at`/`last_seen_at` forward at most
  once per few minutes (avoid a write on every request).
- **Revoke**: logout deletes the row and clears the cookie; a password change
  deletes *all* of that user's other sessions (log out other devices).
- **Sweep**: delete `WHERE expires_at < now` opportunistically on lookup and
  on an interval timer.

### Rate limiter

`bumpRateLimit(key, windowMs, max)` — floor `now` to the window, `INSERT …
ON CONFLICT(key,window_start) DO UPDATE SET count = count + 1` in a
transaction, return whether `count <= max`. Keys: `login:<username>` and
`login-ip:<ip>` for sign-in, `pw-reset:<admin id>` for admin resets. Login is
throttled (e.g. 10 / 15 min / username) to blunt credential stuffing —
something the Supabase variant could only assume from GoTrue's ambient config.

### Bootstrap (global admin), in `server/db.js` seed step

On first boot, if `users` is empty: create username **`admin`**, password
**`bentoos`** (scrypt-hashed), role `global_admin`,
`requires_password_change = 1`; then backfill any pre-existing seed
entries/prompts to that admin. Idempotent: skipped once a global admin
exists. This replaces the Supabase variant's external `setup:admin` script —
no separate command to run.

## 4. RBAC middleware & the forced-rotation gate

Composed per route in `server/index.js`:

```
requireAuth            → 401 UNAUTHENTICATED if no valid session cookie
requirePasswordChanged → 403 PASSWORD_CHANGE_REQUIRED if req.user.requires_password_change,
                          EXCEPT on /api/auth/change-password | logout | me
requireAdmin           → 403 FORBIDDEN unless role in (admin, global_admin)
requireGlobalAdmin     → 403 FORBIDDEN unless role = global_admin
```

`requirePasswordChanged` is the key improvement over the Supabase variant:
the forced rotation is enforced **server-side**, so a stolen/again-defaulted
account cannot read or write data by skipping the UI (the review's finding #1
on the Supabase side). All of `/api/entries`, `/api/prompts`, `/api/import`,
`/api/users` sit behind `requireAuth → requirePasswordChanged`.

## 5. Endpoints

### Auth (`/api/auth`, `server/routes/auth.js`)

| Method & path | Purpose | Notes |
|---|---|---|
| `POST /api/auth/login` | `{username,password}` → set cookie | Rate-limited; returns `{user:{id,username,role,requires_password_change}}`; generic "wrong id or password" (no user-enumeration) |
| `POST /api/auth/logout` | delete session, clear cookie | |
| `GET /api/auth/me` | current user or 401 | boot gate reads this |
| `POST /api/auth/change-password` | `{new_password, current_password?}` | **server enforces** length ≥ 8 and `new_password !== 'bentoos'`; `current_password` required unless in forced-rotation; clears the flag; rotates sessions |
| `POST /api/auth/signup` | `{username,password}` → normal user | Self-signup; can be disabled via env (`BENTO_OPEN_SIGNUP=0`) to make it admin-only |

### User management (`/api/users`, admin-gated, `server/routes/users.js`)

| Method & path | Guard | Purpose |
|---|---|---|
| `GET /api/users` | admin | List `{id, username, role, requires_password_change}` only — **no** password_hash, no session/IP data (data blindness) |
| `POST /api/users/:id/reset-password` | admin | Target must be role `user`; resets to `bentoos`, sets the flag; rate-limited |
| `POST /api/users/:id/promote` | global_admin | `user → admin` |
| `POST /api/users/:id/demote` | global_admin | `admin → user` |
| `DELETE /api/users/me` | auth | GDPR self-delete (hard, cascade); global admin rejected |

### Content (unchanged shape, now scoped)

`/api/entries`, `/api/prompts`, `/api/import` keep their exact contract from
[IMPLEMENTATION-PLAN.md §3](IMPLEMENTATION-PLAN.md) — same bodies, same 409
optimistic-concurrency, same error envelope — with `user_id` scoping added
transparently (§6). The frontend `logbook.js` / `prompts.js` need **no
changes**.

## 6. Per-user scoping helper (isolation you can't forget)

To keep the "every query carries `user_id`" invariant enforceable, the
content routes go through a thin owned-table helper rather than raw SQL
scattered inline, e.g.:

```
ownedEntries(userId).list({q, tag, label})
ownedEntries(userId).get(id)          // 404 if not owned (no existence leak)
ownedEntries(userId).create(data)     // user_id stamped here, never from body
ownedEntries(userId).update(id, data, expectedUpdatedAt)  // 404 / 409 / ok
ownedEntries(userId).remove(id)
```

Every statement inside carries `AND user_id = @userId`. A raw
`entries`/`prompts` query without a `user_id` predicate is then a reviewable
red flag (grep-enforced, same spirit as the single render choke-point in
SECURITY.md §6).

## 7. Frontend (`src/js/auth.js`, mirrors the Supabase UX)

Same screens and flows as IMPLEMENTATION-SUPABASE, but talking to
`/api/auth/*` and relying on the httpOnly cookie (no token handling in JS):

- **Login portal** — full-screen `#auth-screen`, User ID + password, with a
  Create-account toggle (hidden when `BENTO_OPEN_SIGNUP=0`).
- **Forced change-password** — shown when `me`/`login` reports
  `requires_password_change`, or when any API call returns
  `403 PASSWORD_CHANGE_REQUIRED`. No cancel while forced.
- **Navbar user chip** — username + role badge; menu: User management
  (admins), Change password, Delete my account (not global admin), Sign out.
- **User-management dialog** — usernames + roles only; Reset password
  (normal users), Make/Remove admin (global admin only). No emails, no IPs,
  no hashes ever reach the client.

`api.js` changes: send same-origin credentials (cookies ride automatically),
add a custom `X-Bento-Request: 1` header on mutations (defense-in-depth CSRF
alongside `SameSite=Strict`), and route `401 → show login`,
`403 PASSWORD_CHANGE_REQUIRED → show change-password`. `main.js` awaits
`GET /api/auth/me` before initializing the LogBook/Prompt tools; normal users
land directly on their LogBook.

## 8. Forgotten passwords (recovery hierarchy)

| Who forgot | Recovery path |
|---|---|
| Normal user | Any admin: User management → *Reset password* (in-app) |
| Standard admin | Global admin: *Remove admin* → *Reset password* → *Make admin* |
| Global admin | Filesystem-access holder: `node scripts/reset-user-password.js admin` — opens `data/bento.db` directly, re-hashes to `bentoos`, sets the flag |

The recovery root of trust is **filesystem access to `data/bento.db`** (the
local analogue of the Supabase service-role key). No email flow exists or is
needed.

## 9. CSP & headers

Unchanged from the base app — everything is same-origin, so no `connect-src`
widening is needed (contrast the Supabase variant, which must allow the
Supabase origin). The cookie is `HttpOnly; SameSite=Strict; Secure` (behind
TLS). Keep `script-src 'self'` (no inline) as the XSS backstop.

## 10. Build phases

| Phase | Scope | Exit criteria |
|---|---|---|
| **L1 — Schema & primitives** | migration 003, `server/auth.js` (hash/session/rate-limit), global-admin seed | fresh DB boots with an `admin` user; scrypt verify round-trips; sessions insert/expire |
| **L2 — Auth endpoints + middleware** | `/api/auth/*`, requireAuth/requirePasswordChanged | login sets cookie; forced-rotation blocks data routes with 403 until changed |
| **L3 — Scoping** | `user_id` on entries/prompts/import via §6 helper | two users never see each other's rows; FTS scoped; 409/immutability intact |
| **L4 — User management + GDPR** | `/api/users/*`, `/api/account`, rate-limited resets | admin resets normal users only; global admin promotes/demotes; self-delete cascades |
| **L5 — Frontend** | `auth.js`, `api.js`, `main.js`, `index.html` | login portal, forced change-pw, navbar username, admin panel; normal user lands on LogBook |
| **L6 — Harden & verify** | recovery script, login throttling, `verify` skill end-to-end | every EDGE-CASES + SECURITY row for auth demonstrably handled |

## 11. How this variant compares to Supabase

| Concern | Local (this doc) | Supabase ([IMPLEMENTATION-SUPABASE](IMPLEMENTATION-SUPABASE.md)) |
|---|---|---|
| Isolation | `WHERE user_id = ?` in routes (code invariant) | RLS `user_id = auth.uid()` (engine-enforced) |
| Session token | httpOnly cookie (not JS-readable) | JWT in localStorage (JS-readable) |
| Forced password change | **server-side gate** (middleware) | frontend-routing only (review finding #1) |
| Password policy | **server-side** (min length, no default reuse) | client-only unless GoTrue configured (review finding #2) |
| FTS ranking | BM25 `ORDER BY rank` | `updated_at DESC` (rank traded away) |
| Sensitive actions | in-process routes + rate-limit table | Edge Functions + `rate_limits` RPC |
| Ops | one process, one file, backups = copy `bento.db` | managed Postgres, Edge Functions, dashboard |
| Multi-device / scale | single host; fine for a personal/tailnet tool | horizontally managed by Supabase |

The local variant is **simpler to run and stronger on the two auth findings**
from the Supabase review; the Supabase variant is stronger on engine-enforced
isolation and managed scale. Pick per deployment, not per preference.

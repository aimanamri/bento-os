# Running Bento OS with Docker

This branch runs Bento OS **entirely on your own machine**. PostgreSQL and the
whole Supabase API surface run as containers next to the app — no cloud
account, no network egress, nothing to sign up for.

> [!IMPORTANT]
> **`main` is unchanged and still points at Supabase Cloud.**
> `src/js/supabase-config.js` keeps your hosted project's URL and anon key, and
> a plain `npm run build` on your machine still targets the cloud exactly as
> before. The Docker stack swaps the backend **at build time only**, inside the
> image, without ever editing that file. Running this stack does not touch your
> cloud deployment, and `git status` stays clean while it runs.

---

## The two ways to run it

| | Backend | Where data lives | Command |
| --- | --- | --- | --- |
| **Cloud** (`main`, default) | Supabase Cloud | Your hosted project | `npm run dev` |
| **Self-hosted** (this stack) | PostgreSQL in a container | The `db-data` Docker volume | `docker compose up -d` |

Both run the same frontend, the same schema from `supabase/migrations/`, the
same RLS policies and the same Edge Functions.

> [!WARNING]
> **This stack is stateful.** Unlike the cloud setup, your data is now *in a
> Docker volume on this machine*. `docker compose down` keeps it;
> **`docker compose down -v` deletes it permanently.** See § Backup & restore.

---

## What actually runs

Seven containers. The app itself still has no data layer — it serves files and
sets headers, exactly as it does against the cloud.

| Service | Image | Port | Role |
| --- | --- | --- | --- |
| `db` | `supabase/postgres:15.8.1.060` | **54322** | PostgreSQL 15. **All your data.** |
| `db-init` | `postgres:15-alpine` | — | One-shot: gives the service roles a password, then exits 0 |
| `auth` | `supabase/gotrue:v2.177.0` | internal | Sign-in, sessions, admin user CRUD |
| `migrate` | `postgres:15-alpine` | — | One-shot: applies `supabase/migrations/*.sql`, then exits 0 |
| `rest` | `postgrest/postgrest:v12.2.12` | internal | Every `sb.from(...)` / `sb.rpc(...)` |
| `functions` | `supabase/edge-runtime:v1.69.12` | internal | `supabase/functions/*` on Deno |
| `gateway` | `nginx:1.27-alpine` | **8000** | Unifies auth/rest/functions on one origin |
| `bento` | built from `Dockerfile` | **8481** | The app — static host + CSP |

`db-init` and `migrate` showing `Exited (0)` is **success**, not a failure.

---

## Step by step, from nothing to a running app

### Step 0 — Prerequisites

Docker Desktop (or Docker Engine 20.10+ with Compose v2) and about 2 GB of
disk for the images. That's the whole list — **Node is not required**, and
neither is the Supabase CLI. The images bring everything.

```bash
docker compose version      # must print v2.x
```

### Step 1 — Enter the repository root

**Every command on this page runs from the directory that contains
`docker-compose.yml`** — the repository root. Compose resolves the build
context, the bind mounts (`./supabase/migrations`, `./docker/…`) and the `.env`
file relative to it, so running from anywhere else fails.

```bash
git clone <your-repo-url> BentoOS
cd BentoOS
git checkout feat/docker-selfhosted-postgres
```

Confirm you're in the right place:

```bash
ls docker-compose.yml Dockerfile docker/ supabase/migrations/
```

### Step 2 — Start the stack

No configuration step. No `.env` to write. No schema to apply by hand:

```bash
docker compose up -d
```

First run takes a few minutes (pulling five images and building the app).
Compose brings the services up in dependency order and waits at each gate — see
§ Startup order for what it's waiting on.

### Step 3 — Create the first admin

The database is running and empty. One command seeds the global admin:

```bash
docker compose --profile setup run --rm setup-admin
```

Expected output:

```
[setup] global admin created (username: admin, password: bentoos)
[setup] first login will force a password change before the dashboard loads
```

It is idempotent — safe to re-run, and it will not create a second global admin
(a partial unique index in the database forbids one regardless).

> If you have Node 22+ on the host, the equivalent is
> `SUPABASE_URL=http://127.0.0.1:8000 SUPABASE_SERVICE_ROLE_KEY=<service-role-key> npm run setup:admin`.
> Node 22 is the floor — `@supabase/supabase-js` needs a native `WebSocket`,
> and on Node 20 the script dies with *"Node.js detected but native WebSocket
> not found"*. The container route above is on Node 22 already.

### Step 4 — Verify

```bash
docker compose ps
```

Expected — note that the two one-shot services are *supposed* to be exited:

```
SERVICE     STATUS
db          Up (healthy)
db-init     Exited (0)
auth        Up (healthy)
migrate     Exited (0)
rest        Up
functions   Up
gateway     Up (healthy)
bento       Up (healthy)
```

Check the schema actually landed, and that the CSP points at the local gateway:

```bash
docker compose logs migrate | tail -3
# [migrate] done — 6 applied, 0 already present

curl -sI http://127.0.0.1:8481/ | grep -o "connect-src[^;]*"
# connect-src 'self' http://localhost:8000 ws://localhost:8000
```

### Step 5 — Sign in

Open **http://localhost:8481** and sign in with `admin` / `bentoos`. You'll be
forced to change the password before the workspace loads.

> Use `localhost`, not `127.0.0.1`. The bundle is built to call
> `http://localhost:8000`, and a browser treats the two as different origins —
> reaching the app at `127.0.0.1:8481` produces a CSP violation on every
> request.

---

## Default credentials and ports

Everything below is a **development default**, baked in so a fresh clone runs
with zero setup. They are all published in this repository, so treat the whole
stack as untrusted until you change them — see § Before exposing this anywhere.

### Ports

| Port | Service | Bound to | What it's for |
| --- | --- | --- | --- |
| **8481** | `bento` | `127.0.0.1` | The app — open this in a browser |
| **8000** | `gateway` | `127.0.0.1` | Supabase API (auth + rest + functions) |
| **54322** | `db` | `127.0.0.1` | **PostgreSQL** — psql, TablePlus, DBeaver |
| **3001** | `bento-dev` | `127.0.0.1` | Dev profile only |

The dev profile deliberately uses **3001**, leaving 3000 free for a host
`npm run dev` against Supabase Cloud — the two are meant to run side by side.

PostgreSQL is on **54322** on the host, not 5432, so it can't collide with a
Postgres you already run locally. Inside the compose network it is plain
`db:5432`.

### PostgreSQL credentials

| Setting | Default |
| --- | --- |
| **Password** | `bentoos-local-dev-password` |
| Host / port | `127.0.0.1` / `54322` |
| Database | `postgres` |
| Superuser | `supabase_admin` |
| Also available | `postgres` (same password) |

The `supabase/postgres` image bootstraps as **`supabase_admin`**, not
`postgres` — that trips people up when connecting by hand. The `db-init`
service gives the `postgres` role the same password so both work:

```bash
# from the host
psql postgresql://postgres:bentoos-local-dev-password@127.0.0.1:54322/postgres

# or without a local psql installed
docker compose exec -e PGPASSWORD=bentoos-local-dev-password db \
  psql -U supabase_admin -d postgres
```

Some useful first queries:

```sql
\dt public.*                              -- your tables
select version from public.schema_migrations;   -- which migrations ran
select username, created_at from public.profiles;
```

### Application credentials

| Setting | Default |
| --- | --- |
| First admin | `admin` / `bentoos` (password change forced at first login) |
| JWT secret | `bento-os-local-dev-jwt-secret-change-me-32b` |
| Anon key | `eyJhbGciOiJIUzI1NiIs…esm2v7G-HRRUBJh_zPGSSMoBmJwQEWELsN9A0J5x4gM` |
| Service role key | `eyJhbGciOiJIUzI1NiIs…IwKkrsdxz1hoNFVWpZp5iQlrWlWPwgO6pVUwbDiG1Tw` |

Self-hosted, there is no dashboard issuing API keys: the anon and service_role
"keys" are just HS256 JWTs carrying a `role` claim, signed with `JWT_SECRET`.
PostgREST reads that claim and switches into the matching Postgres role for the
transaction — which is exactly what puts your RLS policies in charge.

Regenerate them any time with:

```bash
npm run gen:keys -- "my-own-secret-at-least-32-characters-long"
```

---

## Directory structure

What's in the repo, and what each part is for:

```
BentoOS/                          ← cd here; docker-compose.yml lives here
│
├── docker-compose.yml            the 7-service stack
├── Dockerfile                    app image (3 stages)
├── Dockerfile.dev                dev image
├── .env.example                  every default, spelled out — copy to .env
├── .env                          OPTIONAL, gitignored, read by Compose
│
├── docker/                       ← self-hosted stack support files
│   ├── gateway.conf                 nginx: /auth/v1 /rest/v1 /functions/v1
│   ├── set-role-passwords.sh        run by db-init  (bind-mounted)
│   ├── apply-migrations.sh          run by migrate  (bind-mounted)
│   └── functions-main/index.ts      Deno router the edge runtime boots
│
├── supabase/                     ← bind-mounted INTO the containers
│   ├── migrations/*.sql             the schema + RLS  → applied by `migrate`
│   └── functions/                   Edge Functions    → served by `functions`
│       ├── _shared/mod.ts
│       ├── admin-create-user/
│       ├── admin-reset-password/
│       ├── admin-delete-user/
│       └── delete-account/
│
├── src/                          ← app source, built into the image
│   ├── index.html
│   ├── css/input.css
│   ├── sw.js  manifest.webmanifest  assets/icons/
│   └── js/
│       ├── supabase-config.js    ⚠ YOUR CLOUD PROJECT — never edited by Docker
│       ├── supabase.js  api.js  auth.js  logbook.js  …
│
├── server/index.js               static host + CSP (no data layer)
├── scripts/
│   ├── build-js.js                  ← performs the backend swap at build time
│   ├── gen-local-keys.js            mint anon / service_role JWTs
│   └── setup-supabase-admin.js      bootstrap the global admin
│
└── dist/                         build output (generated, gitignored)
```

Note the split: `supabase/` and `docker/` are **bind-mounted into their own
containers at run time** — they're excluded from the app image's build context
by `.dockerignore`, because the app image doesn't need them.

---

## How the pieces fit

### Startup order

The ordering is load-bearing. Each arrow is a gate Compose actually waits on:

```mermaid
flowchart TD
  A["db<br/>PostgreSQL starts, image creates roles,<br/>auth schema and auth.uid()"] -->|healthy| B["db-init<br/>gives supabase_auth_admin +<br/>authenticator a password"]
  B -->|exit 0| C["auth (GoTrue)<br/>runs ITS migrations →<br/>creates auth.users"]
  C -->|healthy| D["migrate<br/>applies supabase/migrations/*.sql"]
  D -->|exit 0| E["rest (PostgREST)"]
  C --> F["functions (Deno)"]
  E --> G["gateway (nginx)"]
  F --> G
  G -->|healthy| H["bento<br/>the app on :8481"]

  style B fill:#4a3c2c,color:#fff
  style D fill:#4a3c2c,color:#fff
  style H fill:#2c4a35,color:#fff
```

Two constraints explain the whole shape:

1. **`db-init` before `auth`.** `supabase/postgres` creates the service roles
   but leaves them without a password (hosted, each service gets a generated
   secret). Until `db-init` sets one, GoTrue and PostgREST cannot connect at
   all — they fail with `password authentication failed`.
2. **`auth` before `migrate`.** Every migration references `auth.users` —
   foreign keys and the `on_auth_user_created` trigger — and that table is
   created by GoTrue's *own* migrations on first boot. Applying the schema
   first fails with `relation "auth.users" does not exist`.

### Request flow

```mermaid
flowchart LR
  B["Browser"]
  APP["bento :8481<br/>app shell + CSP"]
  GW["gateway :8000"]
  AU["auth"]
  RS["rest"]
  FN["functions"]
  DB[("db :54322<br/>PostgreSQL")]

  APP -->|"HTML/CSS/JS, once"| B
  B -->|"/auth/v1/*"| GW
  B -->|"/rest/v1/*"| GW
  B -->|"/functions/v1/*"| GW
  GW --> AU --> DB
  GW --> RS --> DB
  GW --> FN --> DB

  style DB fill:#2c4a35,color:#fff
  style APP fill:#2c3a4a,color:#fff
```

The app container is never in the write path — it hands over the bundle and is
done. Authorisation happens in Postgres: PostgREST connects as `authenticator`
(a role with no rights of its own) and switches into `anon`, `authenticated` or
`service_role` per request based on the JWT, so the RLS policies in
`supabase/migrations/` decide every read and write.

### How the backend gets swapped without touching your source

This is the mechanism that keeps `main` on the cloud:

```mermaid
flowchart TD
  SRC["src/js/supabase-config.js<br/>(committed — Supabase Cloud)"]
  ENV["BENTO_SUPABASE_URL +<br/>BENTO_SUPABASE_ANON_KEY"]
  BLD["scripts/build-js.js<br/>esbuild plugin"]
  OUT1["dist/js/app.js → Supabase Cloud"]
  OUT2["dist/js/app.js → http://localhost:8000"]

  SRC --> BLD
  ENV -.->|"set? swap the module<br/>IN MEMORY"| BLD
  BLD -->|"unset: npm run build"| OUT1
  BLD -->|"set: docker compose build"| OUT2

  style SRC fill:#2c3a4a,color:#fff
  style OUT2 fill:#2c4a35,color:#fff
```

`docker-compose.yml` passes the two variables as **build args**; the esbuild
plugin in `scripts/build-js.js` replaces the config module *in memory* during
bundling. The file on disk is never written to — which matters most for the dev
profile, where your working tree is bind-mounted and a rewrite would show up as
a real edit in `git status`.

The same `BENTO_SUPABASE_URL` is passed to the runtime so `server/index.js`
pins the CSP `connect-src` to the same origin the bundle calls. They cannot
drift apart.

---

## Configuration

Compose reads `.env` from the repo root. Start from the annotated template:

```bash
cp .env.example .env
```

| Variable | Default | What it does |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | `bentoos-local-dev-password` | Password for the DB superuser and every service role |
| `POSTGRES_DB` | `postgres` | Database name |
| `POSTGRES_HOST_PORT` | `54322` | Host port for psql |
| `JWT_SECRET` | `bento-os-local-dev-…-32b` | Signs and verifies every token |
| `ANON_KEY` / `SERVICE_ROLE_KEY` | *(see above)* | JWTs derived from `JWT_SECRET` |
| `JWT_EXPIRY` | `3600` | Access-token lifetime, seconds |
| `BENTO_BIND` | `127.0.0.1` | Host interface for the app and gateway |
| `BENTO_HOST_PORT` | `8481` | Host port for the app |
| `GATEWAY_HOST_PORT` | `8000` | Host port for the Supabase API |
| `BENTO_DEV_HOST_PORT` | `3001` | Host port for the dev profile |
| `DOCKER_UID`/`DOCKER_GID` | `1001` | Dev profile only; on Linux set to your `id -u`/`id -g` |

Apply changes with `docker compose up -d`. Changing `GATEWAY_HOST_PORT` also
changes the URL baked into the bundle, so that one needs
`docker compose up -d --build`.

### Rotating the credentials

`JWT_SECRET`, the two keys and the config all have to move together:

```bash
npm run gen:keys -- "a-new-secret-of-at-least-32-characters"   # paste into .env
docker compose down
docker compose up -d --build
```

`POSTGRES_PASSWORD` is different. It is fixed inside the data directory at
first initialisation, so changing it in `.env` only re-points the *clients*.
`db-init` re-runs on every `up` and will update the service roles, but the
superuser password stays as initialised — to change that too, either `ALTER
ROLE supabase_admin` by hand or start from a fresh volume (§ Backup first).

### Before exposing this anywhere

Every credential above is committed to this repository. On loopback that's
fine. Before the stack is reachable by anything else:

1. Change `POSTGRES_PASSWORD` **on a fresh volume**.
2. Generate a new `JWT_SECRET` and key pair (`npm run gen:keys`).
3. Change the admin password (the app forces this at first login anyway).
4. Keep `BENTO_BIND=127.0.0.1` and front it with Tailscale rather than
   publishing to the LAN:

   ```bash
   tailscale serve --bg https / http://127.0.0.1:8481
   ```

Note that the gateway on `:8000` must also be reachable by the browser — it's a
direct client→API call, not proxied through the app — so remote access means
serving both ports and rebuilding with the public gateway URL.

---

## Everyday commands

```bash
docker compose ps                     # status + health
docker compose logs -f bento          # follow one service
docker compose logs migrate           # what the schema step did
docker compose restart bento          # restart the app only
docker compose up -d --build          # rebuild after code changes
docker compose down                   # stop; KEEPS your data
docker compose down -v                # stop and DELETE your data

docker compose --profile setup run --rm setup-admin    # (re)create the global admin
```

Adding a migration:

```bash
# drop the .sql file into supabase/migrations/, then
docker compose up -d migrate
docker compose logs migrate | tail -3
```

The runner records applied files in `public.schema_migrations`, so only the new
one runs. Editing a migration that already applied does nothing — add a new
file instead.

---

## Development

The dev service is behind a Compose profile so it never starts by accident. It
uses the same database and API stack as production.

```bash
docker compose --profile dev up -d --build bento-dev
```

Open **http://localhost:3001** — 3000 is intentionally left free so a host
`npm run dev` against Supabase Cloud can run at the same time.

> After changing `Dockerfile.dev` or dependencies, add `--force-recreate
> --renew-anon-volumes`. The container's `node_modules` lives in an anonymous
> volume that survives a plain rebuild, and a stale one shows up as
> `Cannot find module …` on startup.

Your working tree is bind-mounted, so the container builds from your live
source — but it still gets the local backend through the environment, so
`src/js/supabase-config.js` keeps pointing at the cloud and `git status` stays
clean.

`node_modules` is **not** mounted: the container keeps its own Linux-built copy
in an anonymous volume so native binaries match the container's platform. Like
the production image, the dev install skips optional dependencies, so
`better-sqlite3` (which only backs the `dev-local-auth` variant) is never built.

The dev container **does** write `dist/` back into your working tree. Docker
Desktop remaps ownership; on Linux the container UID must match yours:

```bash
printf 'DOCKER_UID=%s\nDOCKER_GID=%s\n' "$(id -u)" "$(id -g)" >> .env
docker compose --profile dev up -d bento-dev
```

There is **no file watcher** — `npm run dev` builds once and serves. After
changing source:

```bash
docker compose --profile dev restart bento-dev
```

If a change still doesn't appear, suspect the service worker before the build:
a rebuilt `dist/` produces a new worker, but the running one keeps serving its
cached copy until every tab is closed (deliberate — an update must never swap
out a session with an unsaved draft). Tick **DevTools → Application → Service
Workers → "Update on reload"**, or use a private window.

---

## Backup & restore

**This is on you now.** There is no managed backup behind this stack — your
entire database is the `db-data` Docker volume on this machine.

```bash
# Back up (schema + data)
docker compose exec -T -e PGPASSWORD=bentoos-local-dev-password db \
  pg_dump -U supabase_admin -d postgres --clean --if-exists \
  > bento-backup-$(date +%F).sql

# Restore into a running stack
docker compose exec -T -e PGPASSWORD=bentoos-local-dev-password db \
  psql -U supabase_admin -d postgres < bento-backup-2026-08-17.sql
```

A dump taken this way includes the `auth` schema, so accounts and passwords
come back with the content.

To move the whole thing to another machine: copy the repo and one dump, then
`docker compose up -d`, restore the dump, and skip the admin bootstrap.

> `docker compose down -v` is the one command that destroys data. Plain `down`
> and `restart` are safe.

---

## How the app image is built

Three stages keep the runtime image small and free of build tooling:

1. **deps** — `npm ci --omit=dev --omit=optional`, leaving `express` and
   `@supabase/supabase-js`. `better-sqlite3` is optional and only backs the
   `dev-local-auth` variant and the one-off `migrate:data` script.
2. **build** — full install, then `npm run build` (Tailwind → static → vendor →
   obfuscated bundle → service-worker stamping). This is where
   `BENTO_SUPABASE_URL` / `BENTO_SUPABASE_ANON_KEY` swap the backend. The step
   then asserts `dist/sw.js`, `dist/manifest.webmanifest`, the icons and
   *exactly one* JS bundle exist — a `.dockerignore` slip that dropped
   `src/assets/` would otherwise yield an image that boots fine and is quietly
   no longer installable, offline-capable, or obfuscated.
3. **runtime** — copies only `node_modules` (prod), `dist/`, `server/`,
   `src/js/supabase-config.js` and `scripts/setup-supabase-admin.js` onto a
   clean `node:22-alpine`, non-root under `tini`, with a healthcheck.

> The base image is **Node 22**, not 20. `@supabase/supabase-js` requires a
> native `WebSocket`, which Node 20 does not provide — the admin bootstrap
> fails there with *"Node.js detected but native WebSocket not found"*.

### Does the image contain my cloud project?

**No.** The Docker files never mention it, and a self-hosted build does not ship
it either.

The runtime keeps one source file — `src/js/supabase-config.js` — because
`server/index.js` reads `SUPABASE_URL` from it to pin the CSP. Copied verbatim
that would carry your hosted URL and anon key into the image, so
`scripts/pin-supabase-config.js` rewrites it during the build whenever
`BENTO_SUPABASE_URL` is set. Verify on any image:

```bash
docker run --rm --entrypoint sh bento-os:selfhosted -c 'cat /app/src/js/supabase-config.js'
```

That script runs **only in the Docker build**, where the source is a throwaway
`COPY`. It is deliberately not part of `npm run build`, because the dev
container bind-mounts your real checkout — there the swap happens in memory via
the esbuild plugin instead, leaving your working tree untouched.

A build with no override (a plain `docker build .`) keeps the committed cloud
config, so the hosted deployment path is unchanged.

The client libraries (`mermaid`, `katex`, `markdown-it`, `dompurify`,
`supabase-js` UMD) are build-time only: they're copied into `dist/vendor/` and
served as static files, so the Node process never `require()`s them.

### The PWA

`http://localhost:8481` is a secure context, so the app installs and works
offline. `http://<lan-ip>:8481` is **not** — the worker silently never
registers there, and the app runs online-only. Use the Tailscale HTTPS serve to
get the full behaviour off the host.

Rebuilding does not evict a running worker: the new one installs and waits so
an open session is never swapped mid-edit, taking over once every tab is
closed.

---

## Security posture

| Setting | Why |
| --- | --- |
| Everything bound to `127.0.0.1` | Nothing is reachable from the LAN by default |
| App container non-root, `read_only`, `cap_drop: ALL` | The app writes nothing |
| `no-new-privileges:true` | Blocks setuid escalation |
| `mem_limit: 512m`, `cpus: 1.0`, `pids_limit: 256` | Caps runaway resource use |
| Log rotation 10m × 3 on every service | Logs can't fill the disk |
| CSP pinned to the gateway origin | A stolen session can't exfiltrate elsewhere |
| `service_role` key only in `functions` | The browser never sees it |
| RLS on every table | Postgres, not the app, isolates users |

The gateway sets CORS headers but no `Access-Control-Allow-Credentials`, and
the API carries no session cookie — supabase-js authenticates with an explicit
`Authorization` header — so a hostile page cannot make authenticated requests
on your behalf.

**The committed credentials are the weak point, not the hardening.** Read
§ Before exposing this anywhere.

---

## Troubleshooting

**`db-init` and `migrate` show `Exited (0)`.** That's correct — they're
one-shot jobs that finish and stop.

**`dependency failed to start: container bento-os-auth is unhealthy`**
GoTrue can't reach the database. `docker compose logs auth`; if it says
`password authentication failed for user "supabase_auth_admin"`, then `db-init`
didn't run or didn't succeed — check `docker compose logs db-init`. On a volume
created before `db-init` existed, recreate it: `docker compose down -v && docker compose up -d`.

**`migrate` fails with `relation "auth.users" does not exist`.** It ran before
GoTrue finished its own migrations. `docker compose up -d migrate` re-runs it;
it's idempotent.

**Sign-in fails with `Failed to fetch` and no CSP error.** A CORS preflight was
rejected. The gateway reflects whatever headers the browser asks for, so this
should not recur — but if it does, read the **request** headers in DevTools →
Network → the failing `OPTIONS` row, and compare them with the
`Access-Control-Allow-Headers` on the response. Anything the browser asked for
that isn't echoed back aborts the request.

Note that **curl will not reproduce this** unless you send the SDK's exact
header set; nginx answers the preflight `204` either way, so the access log
looks perfectly healthy. Reproduce it with:

```bash
curl -s -D - -o /dev/null -X OPTIONS "http://localhost:8000/auth/v1/token?grant_type=password" \
  -H "Origin: http://localhost:8481" -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization,apikey,content-type,x-client-info,x-supabase-api-version" \
  | grep -i access-control-allow-headers
```

**Sign-in fails, console shows a CSP `connect-src` violation.** Almost always
`127.0.0.1` vs `localhost`. The bundle calls `http://localhost:8000`, so open
the app at **http://localhost:8481**. If you changed `GATEWAY_HOST_PORT`, you
need `docker compose up -d --build` — the URL is baked in at build time.

**Sign-in returns 400 `Invalid login credentials`.** The admin bootstrap
(Step 3) hasn't run, or ran against a different volume. Re-run
`docker compose --profile setup run --rm setup-admin`.

**`Node.js detected but native WebSocket not found`.** You ran the admin
bootstrap on the host with Node 20 or older. Use the container form in Step 3,
or upgrade to Node 22+.

**Everything 401s after changing `JWT_SECRET`.** The keys are derived from it.
Regenerate both with `npm run gen:keys`, put them in `.env`, and rebuild.

**Edge function returns 404 `Function "x" is not deployed`.** The `functions`
container mounts `./supabase/functions`; check the directory name matches the
`invoke()` name exactly and that it contains an `index.ts`.

**Port already in use.** Change `BENTO_HOST_PORT`, `GATEWAY_HOST_PORT` or
`POSTGRES_HOST_PORT` in `.env`. Changing the gateway port needs `--build`.

**`bad interpreter: Permission denied` on a script in `docker/`.** Docker
Desktop mounts the host filesystem noexec. The scripts are invoked as
`sh <script>` for exactly this reason — don't change those entrypoints to run
the file directly, and don't move them into `/docker-entrypoint-initdb.d`
(mounting a directory there also wipes the image's own role and schema setup).

**Build uploads hundreds of MB of context.** Check `.dockerignore` still
excludes `.worktrees/` and `**/node_modules/`.

**I want my cloud setup back.** `docker compose down`, then `npm run dev`.
Nothing about this stack modified your cloud configuration.

# Running Bento OS with Docker

Bento OS ships two images:

| Image            | File            | Purpose                                            |
| ---------------- | --------------- | -------------------------------------------------- |
| `bento-os:latest`| `Dockerfile`    | Production — small, hardened, non-root, read-only. |
| `bento-os:dev`   | `Dockerfile.dev`| Development — source bind-mounted, no hardening.   |

**The container is stateless.** On this branch Bento OS is a *static host*: the
browser talks straight to Supabase (PostgreSQL + Auth) for every read and
write, so the image carries no database, mounts no volumes, and needs no
writable path. Your data is not in the container — it's in your Supabase
project. That's what makes moving to another machine trivial.

> The local-SQLite variant (`dev-local-auth`) *is* stateful and bind-mounts
> `./data`. Its Docker files mirror this structure but keep the volume,
> the WAL-aware shutdown, and a real backup story — see that branch's
> DOCKER.md.

---

## Running it on another machine

Everything the container needs is in the repo — the Supabase URL and anon key
live in `src/js/supabase-config.js` and are baked into the bundle at build
time. There is no state to copy across and no secret to hand over.

```bash
git clone <your-repo-url> BentoOS
cd BentoOS
docker compose up -d          # build (first run) + start in the background
```

Open **http://127.0.0.1:8481** and sign in with your existing account. The new
machine reaches the same Supabase project, so your LogBook, prompts, and
snippets are already there.

> The anon key is safe to ship — every table is protected by Row-Level
> Security and the key grants nothing on its own (SECURITY.md). The
> `service_role` key must never appear in this repo or in an image.

### Pointing a deployment at a *different* Supabase project

Only needed if the new machine should use its own backend rather than share
yours:

1. Edit `src/js/supabase-config.js` with the new project's URL and anon key.
2. Apply the schema to it: `supabase link --project-ref <ref> && supabase db push`.
3. Create the first admin: `npm run setup:admin`.
4. Rebuild so the new config is baked in: `docker compose up -d --build`.

The config is compiled into `dist/` at **build** time, so a rebuild is
mandatory — restarting the container is not enough.

---

## Where the app writes data

A read-only container still saves your work, because the container is not in
the write path at all:

```
browser  ──HTTPS──▶  Supabase (Postgres + Auth)     ← every create/edit/delete
   │
   └──HTTP──▶  bento-os container                    ← HTML/CSS/JS only, never written to
```

The container serves files and nothing else, so `read_only: true` costs you
nothing. What *can* silently break writing is the **Content-Security-Policy**:
the browser refuses to call any origin missing from `connect-src`. The image
therefore ships `src/js/supabase-config.js` and `server/index.js` reads the
project URL out of it, pinning the header to exactly one project. Verify it on
a running container:

```bash
curl -sI http://127.0.0.1:8481/ | grep -o "connect-src[^;]*"
# connect-src 'self' https://<ref>.supabase.co wss://<ref>.supabase.co
```

If that origin doesn't match the `SUPABASE_URL` in
`http://127.0.0.1:8481/js/supabase-config.js`, sign-in and every save will fail
with a CSP violation in the browser console. They come from the same file, so
they only diverge if `BENTO_SUPABASE_URL` is set to something else.

The one container that *does* write to disk is the **dev** profile — it
regenerates `dist/` inside the bind-mounted source tree. See § Development.

## Configuration

Compose reads a `.env` file sitting next to `docker-compose.yml`, so per-machine
settings never need a file edit:

| Variable             | Default            | What it does                                                        |
| -------------------- | ------------------ | ------------------------------------------------------------------- |
| `BENTO_BIND`         | `127.0.0.1`        | Host interface the port is published on. `0.0.0.0` exposes the LAN.  |
| `BENTO_HOST_PORT`    | `8481`             | Host port. The in-container port stays `3000`.                       |
| `BENTO_SUPABASE_URL` | *(from the bundle)* | Pins the CSP `connect-src` to one Supabase origin. Unset = use the project baked into `src/js/supabase-config.js`. |
| `DOCKER_UID` / `DOCKER_GID` | `1001` | **Dev profile only.** Host user the container writes `dist/` as. On Linux set these to your `id -u` / `id -g`. |

Example `.env` for a home-server box on a different port:

```ini
BENTO_HOST_PORT=9000
```

Apply changes with `docker compose up -d` (Compose recreates the container).

### Exposing it

The port is published on **loopback only** by default — nothing is reachable
from your LAN. To get at it from other devices, the recommended route is
Tailscale, which keeps the listener private and adds identity and TLS:

```bash
tailscale serve --bg https / http://127.0.0.1:8481
```

Setting `BENTO_BIND=0.0.0.0` instead publishes to every interface on the host.
Bento OS has no transport security of its own — it would be plain HTTP on your
LAN — so only do that behind a reverse proxy that terminates TLS.

---

## Everyday commands

```bash
docker compose logs -f                # follow logs
docker compose ps                     # status + health
docker compose restart bento          # restart
docker compose down                   # stop & remove the container
docker compose up -d --build          # rebuild after code changes
```

`docker compose down` destroys nothing: there is no volume, and the data is in
Supabase.

### Build the image by hand (without compose)

```bash
docker build -t bento-os:latest .

docker run -d --name bento-os \
  -p 127.0.0.1:8481:3000 \
  -e BENTO_HOST=0.0.0.0 \
  --read-only --tmpfs /tmp \
  --cap-drop ALL --security-opt no-new-privileges \
  --memory 512m --pids-limit 256 \
  --restart unless-stopped \
  bento-os:latest
```

> `BENTO_HOST=0.0.0.0` makes the server listen on all interfaces **inside** the
> container so Docker's port forwarding works. The host still only publishes to
> `127.0.0.1`, so this does not widen your exposure. Without it the server binds to
> loopback *inside* the container and Docker can't reach it.

---

## Development

The dev service is behind a Compose **profile** so it never starts by accident.

```bash
docker compose --profile dev up bento-dev      # build + run with live source mounted
```

Open **http://127.0.0.1:3000**.

Your working tree is bind-mounted into the container. `node_modules` is **not** —
the container keeps its own Linux-built copy (via an anonymous volume) so native
binaries match the container's platform, not your Mac's.

Unlike production, this container **does** write to the host: `npm run dev`
regenerates `dist/` inside the bind mount. Docker Desktop (macOS/Windows) remaps
ownership so that just works. **On a Linux host** the container's UID must match
yours or the build fails with `EACCES`:

```bash
printf 'DOCKER_UID=%s\nDOCKER_GID=%s\n' "$(id -u)" "$(id -g)" >> .env
docker compose --profile dev up -d bento-dev
```

There is **no file watcher**: the container runs `npm run dev`, which rebuilds the CSS/
static/vendor assets once and starts the server. After changing source, restart:

```bash
docker compose --profile dev restart bento-dev
```

Stop it:

```bash
docker compose --profile dev down
```

---

## How the production image is built

A three-stage build keeps the runtime image small and free of build tooling:

1. **deps** — installs *production* dependencies only, and skips optional ones
   (`npm ci --omit=dev --omit=optional`). That leaves `express` alone:
   `better-sqlite3` is optional and only backs the local-SQLite variant and the
   one-off `migrate:data` script, neither of which runs in this image.
2. **build** — installs everything and runs `npm run build` (Tailwind + static +
   vendor copy), producing `dist/`.
3. **runtime** — copies just `node_modules` (prod), `dist/`, `server/`, and
   `src/js/supabase-config.js` onto a clean `node:20-alpine`, running as a
   non-root user under `tini`.

The client libraries (`mermaid`, `katex`, `markdown-it`, `dompurify`,
`supabase-js`) are **build-time only**: they're bundled into `dist/vendor` and
served as static files, so the Node server never loads them. They live in
`devDependencies` and are therefore excluded from the runtime image.

`supabase-config.js` is the one source file the runtime keeps. `server/index.js`
reads `SUPABASE_URL` out of it to pin the CSP `connect-src` to your project;
without it the CSP would have to fall back to a `https://*.supabase.co`
wildcard that would permit connections to *any* Supabase project.

The `supabase/` directory (migrations + Edge Functions) is excluded from the
build context — it's deployed with the `supabase` CLI, not shipped in the image.

---

## Security & resource posture (production)

The compose file applies these by default:

| Setting                          | Why                                                   |
| -------------------------------- | ----------------------------------------------------- |
| `127.0.0.1:8481` binding         | Not reachable from the LAN; Tailscale fronts it.      |
| Non-root user (`nodejs`, 1001)   | No root inside the container.                          |
| `read_only: true` + `tmpfs /tmp` | Immutable root filesystem; the app writes nothing.    |
| `cap_drop: ALL`                  | The server needs no Linux capabilities.               |
| `no-new-privileges:true`         | Blocks setuid privilege escalation.                   |
| `mem_limit: 512m` (+ no swap)    | Caps memory; `NODE_OPTIONS` bounds the V8 heap.       |
| `cpus: 1.0`, `pids_limit: 256`   | Caps CPU and process/thread fork bombs.               |
| `logging` max 10m × 3            | Log rotation so logs can't fill the disk.             |
| `HEALTHCHECK` on `/`             | Docker restarts/reports on an unhealthy container.    |
| CSP pinned to your project       | A stolen session can't exfiltrate to another origin.  |

Row-Level Security in Postgres — not this container — is what isolates one
user's data from another's. Running the image on an untrusted machine exposes
no data by itself, but anyone who can reach the port can attempt to sign in.

---

## Backup & restore

There is nothing in the container to back up. Your data is in Supabase, so
backups happen there:

```bash
supabase db dump --linked -f bento-backup-$(date +%F).sql        # schema + data
```

Hosted projects also keep automatic daily backups (Dashboard → Database →
Backups), which is the fastest path for point-in-time restore. To restore a
dump into a project: `psql "$DATABASE_URL" -f bento-backup-YYYY-MM-DD.sql`.

---

## Troubleshooting

- **Blank page, console shows a CSP `connect-src` violation:** the container is
  pinning a different Supabase origin than the bundle is calling. Check
  `BENTO_SUPABASE_URL` in `.env` — unset it to fall back to the project baked
  into `src/js/supabase-config.js`, then `docker compose up -d`.
- **Sign-in fails with "Couldn't reach Supabase":** the project may be paused
  (free tier pauses after inactivity) — resume it in the Dashboard. Otherwise
  check outbound network from the host.
- **Config changes don't take effect:** `src/js/supabase-config.js` is baked in
  at build time. Use `docker compose up -d --build`, not `restart`.
- **No install option / the app doesn't work offline:** service workers need a
  secure context. Reaching the container at `http://localhost:3000` counts as
  one; reaching it at `http://<lan-ip>:3000` does not, and the app silently
  runs online-only. Put it behind the HTTPS Tailscale serve (README) to get
  the installable, offline-capable build over the network.
- **Container is `unhealthy`:** `docker compose logs bento` — the healthcheck
  fetches `/` every 30s after a 10s grace period.
- **Port already in use:** set `BENTO_HOST_PORT` in `.env` (e.g. `9000`); the
  in-container port stays `3000`.
- **Build is slow or uploads hundreds of MB of context:** make sure
  `.dockerignore` still excludes `.worktrees/` and `**/node_modules/` — sibling
  branch checkouts are large.

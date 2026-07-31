# Running Bento OS with Docker

Bento OS ships two images:

| Image            | File            | Purpose                                            |
| ---------------- | --------------- | -------------------------------------------------- |
| `bento-os:latest`| `Dockerfile`    | Production — small, hardened, non-root, read-only. |
| `bento-os:dev`   | `Dockerfile.dev`| Development — source bind-mounted, no hardening.   |

**The container owns your data.** This is the local-SQLite variant: the database
(plus its WAL files) lives in `./data` on the host and is bind-mounted into the
container, so it survives rebuilds and image deletes. Nothing leaves the
machine — and nothing follows you to another one unless you carry `./data`
with it.

> The Supabase variant (`main` / `dev-supabase`) is stateless instead: the
> browser talks to a hosted Postgres, the container mounts no volume, and
> moving machines is just a clone. Its Docker files mirror this structure —
> see that branch's DOCKER.md.

---

## Running it on another machine

```bash
git clone <your-repo-url> BentoOS
cd BentoOS
docker compose up -d          # build (first run) + start in the background
```

That gives you an **empty** Bento OS with a fresh `admin` / `bentoos` bootstrap
(see § First login). To bring your existing content along, copy the database
over before the first start:

```bash
# on the old machine — stop first so the WAL is checkpointed into the .db file
docker compose down
tar czf bento-data.tgz data/

# on the new machine, from the repo root
tar xzf bento-data.tgz          # restores ./data
sudo chown -R 1001:1001 ./data  # Linux hosts only — the container runs as UID 1001
docker compose up -d
```

Your accounts and passwords come with it — the users table is inside that same
database.

---

## Where the app writes data

Everything the server writes goes to one place:

```
browser ──HTTP──▶ bento-os container ──▶ /app/data/bento.db   ← bind-mounted to ./data
                  (read-only rootfs)      + bento.db-wal / -shm
```

The root filesystem is mounted **read-only**; `./data` is the single exception
and the only path the app can write. Two things must hold or writes fail:

- **The host dir must be writable by UID 1001** (the container's `nodejs`
  user). Docker Desktop on macOS/Windows handles this; on Linux run
  `sudo chown -R 1001:1001 ./data`. Otherwise the server exits at boot —
  `server/db.js` opens the database while the module loads.
- **Shut down gracefully** so SQLite checkpoints its WAL. `docker compose down`
  and `restart` both send SIGTERM, which `tini` forwards to Node;
  `stop_grace_period: 15s` gives the checkpoint room to finish.

Confirm it's actually writing:

```bash
docker compose exec bento ls -l /app/data     # bento.db + -wal, owned by nodejs
```

---

## Configuration

Compose reads a `.env` file sitting next to `docker-compose.yml`, so per-machine
settings never need a file edit:

| Variable             | Default     | What it does                                                       |
| -------------------- | ----------- | ------------------------------------------------------------------ |
| `BENTO_BIND`         | `127.0.0.1` | Host interface the port is published on. `0.0.0.0` exposes the LAN. |
| `BENTO_HOST_PORT`    | `8481`      | Host port. The in-container port stays `3000`.                      |
| `BENTO_OPEN_SIGNUP`  | `1`         | Self-signup for new accounts; `0` locks it to admin-created only.    |
| `DOCKER_UID` / `DOCKER_GID` | `1001` | **Dev profile only.** Host user the container writes as. On Linux set these to your `id -u` / `id -g`. |

### Exposing it

The port is published on **loopback only** by default — nothing is reachable
from your LAN. The recommended route to other devices is Tailscale, which keeps
the listener private and adds identity and TLS:

```bash
tailscale serve --bg https / http://127.0.0.1:8481
```

Setting `BENTO_BIND=0.0.0.0` publishes to every interface on the host. Bento OS
serves plain HTTP with cookie-based sessions, so only do that behind a reverse
proxy that terminates TLS.

---

## Production

### Start it

```bash
docker compose up -d          # build (first run) + start in the background
```

Open **http://127.0.0.1:8481** (change the host port with `BENTO_HOST_PORT` —
see § Configuration).

### First login

The first boot against an empty `./data` bootstraps a single global admin:

```
username: admin
password: bentoos
```

A password change is forced on that first login. Self-signup for additional
accounts is on by default (`role: user`) — set `BENTO_OPEN_SIGNUP=0` in `.env`
to make new accounts admin-created only.

### Everyday commands

```bash
docker compose logs -f                # follow logs
docker compose ps                     # status + health
docker compose restart bento          # restart
docker compose down                   # stop & remove the container (data is kept)
docker compose up -d --build          # rebuild after code changes
```

### Build the image by hand (without compose)

```bash
docker build -t bento-os:latest .

docker run -d --name bento-os \
  -p 127.0.0.1:8481:3000 \
  -e BENTO_HOST=0.0.0.0 \
  -v "$(pwd)/data:/app/data" \
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

Open **http://127.0.0.1:3000**. First login is the same bootstrapped admin as
production (`admin` / `bentoos`, password change forced) unless `./data` already
holds a database from a previous run.

This container writes more than production does: `npm run dev` regenerates
`dist/` inside the bind mount, on top of the usual `./data`. Docker Desktop
(macOS/Windows) remaps ownership so that just works. **On a Linux host** the
container's UID must match yours or the build fails with `EACCES`:

```bash
printf 'DOCKER_UID=%s\nDOCKER_GID=%s\n' "$(id -u)" "$(id -g)" >> .env
docker compose --profile dev up -d bento-dev
```

Your working tree is bind-mounted into the container. `node_modules` is **not** —
the container keeps its own Linux-built copy (via an anonymous volume) so the native
`better-sqlite3` binary matches the container's platform, not your Mac's.

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

1. **deps** — installs *production* dependencies only (`express`, `better-sqlite3`).
2. **build** — installs everything and runs `npm run build` (Tailwind + vendor copy),
   producing `dist/`.
3. **runtime** — copies just `node_modules` (prod), `dist/`, `server/`, and `scripts/`
   (for break-glass password recovery) onto a clean `node:20-alpine`, runs as a
   non-root user under `tini`.

The client libraries (`mermaid`, `katex`, `markdown-it`, `dompurify`) are
**build-time only**: they're bundled into `dist/vendor` and served as static files, so
the Node server never loads them. They live in `devDependencies` and are therefore
excluded from the runtime image — which is why it's ~225 MB instead of ~425 MB.

---

## Security & resource posture (production)

The compose file applies these by default:

| Setting                          | Why                                                   |
| -------------------------------- | ----------------------------------------------------- |
| `127.0.0.1:8481` binding         | Not reachable from the LAN; Tailscale fronts it.      |
| Non-root user (`nodejs`, 1001)   | No root inside the container.                          |
| `read_only: true` + `tmpfs /tmp` | Immutable root filesystem; only `./data` is writable. |
| `cap_drop: ALL`                  | The server needs no Linux capabilities.               |
| `no-new-privileges:true`         | Blocks setuid privilege escalation.                   |
| `mem_limit: 512m` (+ no swap)    | Caps memory; `NODE_OPTIONS` bounds the V8 heap.       |
| `cpus: 1.0`, `pids_limit: 256`   | Caps CPU and process/thread fork bombs.               |
| `logging` max 10m × 3            | Log rotation so logs can't fill the disk.             |
| `HEALTHCHECK` on `/api/health`   | Docker restarts/report on an unhealthy container.     |
| `BENTO_OPEN_SIGNUP=1`            | Self-signup on by default; set to `0` to lock new accounts to admin-created only. |

---

## Backup & restore

Everything is in `./data`. To back up, stop the container first so the WAL is
checkpointed cleanly:

```bash
docker compose down
tar czf bento-backup-$(date +%F).tgz data/
docker compose up -d
```

Restore by replacing `./data` with an extracted backup before `docker compose up -d`.

---

## Password recovery

Locked out (including the global admin)? Reset a user's password from the host —
this only requires filesystem/shell access to the running container, matching the
local variant's recovery model (see `docs/IMPLEMENTATION-LOCAL.md` §8):

```bash
docker compose exec bento node scripts/reset-user-password.js <username>
```

This resets the password to `bentoos`, forces a change on next login, and revokes
that user's active sessions. The runtime image ships `scripts/reset-user-password.js`
for exactly this purpose (see the `Dockerfile`'s runtime stage).

---

## Troubleshooting

- **`permission denied` on `./data` (Linux hosts):** the container runs as UID 1001.
  Give it ownership of the host dir: `sudo chown -R 1001:1001 ./data`. (On macOS/Docker
  Desktop this is handled automatically.)
- **No install option / the app doesn't work offline:** service workers need a
  secure context. Reaching the container at `http://localhost:3000` counts as
  one; reaching it at `http://<lan-ip>:3000` does not, and the app silently
  runs online-only. Put it behind the HTTPS Tailscale serve (README) to get
  the installable, offline-capable build over the network.
- **Container is `unhealthy`:** `docker compose logs bento` — the healthcheck probes
  `/api/health` every 30s after a 10s grace period.
- **Port already in use:** change the host side of the mapping in `docker-compose.yml`
  (e.g. `"127.0.0.1:9000:3000"`); the in-container port stays `3000`.
- **`better-sqlite3` errors after switching Mac ⇆ container:** never share a host
  `node_modules` with the container. The dev setup already prevents this with an
  anonymous `node_modules` volume.

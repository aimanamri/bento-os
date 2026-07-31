# Bento OS 🍱

Multi-user personal knowledge base and prompt library. Vanilla JS + Tailwind
frontend, Express + SQLite (WAL) backend with server-side auth/RBAC, macOS
bento-glass UI, Tailscale-only remote access. See [PROJECT-BRIEF.md](PROJECT-BRIEF.md)
and [docs/](docs/) for the full specification — auth design in
[docs/IMPLEMENTATION-LOCAL.md](docs/IMPLEMENTATION-LOCAL.md) and
[docs/DATABASE-LOCAL.md](docs/DATABASE-LOCAL.md).

## Run

```bash
npm install
npm run dev        # builds CSS/static/vendor, then starts the server
```

Open http://127.0.0.1:3000 and sign in. On first boot a **global admin** is
created — username `admin`, password `bentoos` — and you're forced to set a
new password before the dashboard opens. The server binds to loopback **only**
(see [docs/SECURITY.md](docs/SECURITY.md) §4).

`npm start` skips the build and just starts the server.

## Install it as an app (PWA)

Bento OS ships a web app manifest and a service worker, so it can be
installed to the dock/home screen and launched in its own window: open it in
the browser and choose **Install Bento OS…** from the account menu (or the
browser's own install control; on iOS, *Share → Add to Home Screen*).

The service worker precaches the app shell — HTML, CSS, JS and the vendored
render libraries — so an installed Bento OS **opens offline** instead of
showing a browser error. It caches the application only: entries, prompts and
snippets come from the Express API and are never cached, so offline you get
the workspace with an *offline* chip and empty lists until the host is
reachable again. See [docs/SECURITY.md](docs/SECURITY.md) §4a.

Registration needs a secure context — `localhost` in development, or the
HTTPS Tailscale serve below. Over plain-HTTP LAN the app runs online-only.
Regenerate the icon set with `npm run icons` after changing the mark.

## Accounts & roles

- **Global admin** (one only): can reset normal-user passwords and promote
  users to admin. **Admins**: reset normal-user passwords. **Normal users**:
  read/write only their own LogBook + prompts. Admins never see other users'
  entries, passwords, or IPs.
- Self-signup is on by default; set `BENTO_OPEN_SIGNUP=0` to make accounts
  admin-created only.
- Forgot the global-admin password? `node scripts/reset-user-password.js admin`
  (needs shell access to the host — the recovery root of trust).
- "Delete my account" is a GDPR/PDPA **hard delete** (account + all data).

## Remote access (Tailscale)

```bash
tailscale serve --bg https / http://127.0.0.1:3000
```

Then open `https://<machine>.<tailnet>.ts.net` from any tailnet device.
HTTPS matters: the Prompt Library's copy button uses the async Clipboard API,
which only exists in secure contexts (there is a manual-copy fallback otherwise).

## Data & backups

- Database: `data/bento.db` (SQLite, WAL mode). Not in git.
- Back up with `sqlite3 data/bento.db ".backup 'backups/bento-$(date +%Y%m%d).db'"` —
  a plain file copy of a live WAL database can tear; `.backup` cannot.
- Drafts autosave to browser localStorage every 10 s while editing; you'll be
  offered a restore after a crash or refresh.

## Layout

```
server/          Express API, SQLite layer, migrations
src/             Frontend source (index.html, css/input.css, js/, sw.js, manifest)
scripts/         Build helpers (static + vendor copy, service worker, icons)
dist/            Build output (generated; served by Express)
docs/            Implementation plan, security spec, edge-case matrix, UX spec
```

The four rendering libraries (markdown-it, KaTeX, Mermaid, DOMPurify) are
vendored into `dist/vendor/` at build time — the CSP forbids CDNs by design.

## Testing

API and UI test suites live in the session scratchpad during development;
the security audit checklist is in [docs/SECURITY.md](docs/SECURITY.md) §6.

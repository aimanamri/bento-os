# Bento OS 🍱

Local-first personal knowledge base and prompt library. Vanilla JS + Tailwind
frontend, Express + SQLite (WAL) backend, macOS bento-glass UI, Tailscale-only
remote access. See [PROJECT-BRIEF.md](PROJECT-BRIEF.md) and [docs/](docs/) for
the full specification.

## Run

```bash
npm install
npm run dev        # builds CSS/static/vendor, then starts the server
```

Open http://127.0.0.1:3000. The server binds to loopback **only** — that is
deliberate (see [docs/SECURITY.md](docs/SECURITY.md) §4).

`npm start` skips the build and just starts the server.

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
src/             Frontend source (index.html, css/input.css, js/)
scripts/         Build helpers (static + vendor copy)
dist/            Build output (generated; served by Express)
docs/            Implementation plan, security spec, edge-case matrix, UX spec
```

The four rendering libraries (markdown-it, KaTeX, Mermaid, DOMPurify) are
vendored into `dist/vendor/` at build time — the CSP forbids CDNs by design.

## Testing

API and UI test suites live in the session scratchpad during development;
the security audit checklist is in [docs/SECURITY.md](docs/SECURITY.md) §6.

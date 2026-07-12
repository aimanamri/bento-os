# Bento OS — Security Specification

> Companion documents: [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) · [EDGE-CASES.md](EDGE-CASES.md) · [UX-SPEC.md](UX-SPEC.md)

---

## 1. Threat Model

Single trusted user, but the app renders rich untrusted-shaped content
(markdown → HTML/SVG/MathML) and is reachable from multiple devices over a
tailnet. Ranked risks:

| # | Threat | Vector | Likelihood | Impact | Primary control |
|---|---|---|---|---|---|
| 1 | **Stored XSS** | Imported `.md` files (pasted from the web), or own notes containing copied snippets, executing script on render | Medium | High (session on every tailnet device that opens the note) | DOMPurify choke point (§ 2) |
| 2 | **Mermaid/SVG injection** | `foreignObject`, `<script>` inside SVG, `javascript:` links in click bindings | Medium | High | `securityLevel: 'strict'` + sanitizer forbid-list (§ 2) |
| 3 | **SQL / FTS5 injection** | Search box, tag filters, any string reaching SQL | Low (parameterized) | High | Prepared statements + FTS quoting (§ 3) |
| 4 | **Compromised tailnet device** | Stolen phone/laptop already inside the tailnet | Low | High | Tailscale ACLs, device expiry, no public bind (§ 4) |
| 5 | **Data loss / corruption** | Crash mid-write, disk failure, bad migration | Medium | High | WAL + backups (§ 5) |
| 6 | **Malicious import file** | Oversized/binary/path-crafted upload | Low | Medium | Import validation (§ 4) |

Explicit non-goals: multi-user auth, rate limiting for abuse (single user
behind tailnet), CSRF tokens (no cookies/sessions — but see § 4 on why the
API still isn't callable cross-origin).

---

## 2. XSS Mitigation — the render pipeline

**Invariant: exactly one function turns user text into DOM** —
`render/pipeline.js` (see IMPLEMENTATION-PLAN.md § 4). No other code path may
assign user-derived strings to `innerHTML`, `outerHTML`, or
`insertAdjacentHTML`. UI chrome built programmatically uses `textContent` /
`createElement` only.

### Pipeline order (order matters)

```
markdown-it ({ html: false })          ← raw HTML in markdown is escaped, not passed through
  → KaTeX renderToString (throwOnError: true, per-block try/catch)
  → Mermaid render (securityLevel: 'strict', per-block try/catch)
  → DOMPurify.sanitize(html, BENTO_PURIFY_CONFIG)   ← LAST, so it sees final HTML
  → mount
```

Sanitizing **after** KaTeX/Mermaid is non-negotiable: sanitizing before would
both miss anything those libraries emit and break their output.

### DOMPurify configuration (`BENTO_PURIFY_CONFIG`)

```js
{
  USE_PROFILES: { html: true, svg: true, mathMl: true }, // KaTeX needs MathML, Mermaid needs SVG
  ADD_TAGS: ['semantics', 'annotation'],                 // KaTeX MathML extras
  ADD_ATTR: ['aria-hidden', 'data-line'],                // KaTeX a11y spans, preview scroll-sync
  FORBID_TAGS: ['foreignObject', 'style', 'form', 'input', 'iframe',
                'object', 'embed', 'base', 'link', 'meta'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'formaction', 'xlink:href', 'href'
               ].filter(/* href allowed ONLY on <a>, enforced via hook below */),
  ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i             // kills javascript:, data:, vbscript:
}
```

Plus a DOMPurify hook that post-processes every kept `<a>`:
`rel="noopener noreferrer" target="_blank"` — notes link out to the web;
no reverse-tabnabbing.

**Why `foreignObject` is force-forbidden even though Mermaid wants it:**
`<foreignObject>` lets SVG embed arbitrary HTML — it is the classic
SVG-sanitizer bypass. Mermaid at `securityLevel: 'strict'` already avoids
emitting it (labels become plain SVG `<text>`); the forbid-list makes the
sanitizer enforce what the renderer promises. Accepted trade-off: no HTML
formatting inside Mermaid node labels.

### Mermaid hardening

- `mermaid.initialize({ securityLevel: 'strict', startOnLoad: false })`
  — strict mode encodes HTML entities in labels and disables `click`
  callbacks/interactivity, which are script-execution vectors.
- Diagrams render only through the pipeline (no auto-scan of the DOM).
- Render errors are caught per-fence; the fallback element is built with
  `textContent` so the *error message itself* (which echoes user input)
  cannot inject.

### KaTeX hardening

- `trust: false` (default) — blocks `\href`, `\includegraphics`, `\htmlClass`
  and other commands that emit URLs/HTML.
- `maxExpand: 1000` — caps macro expansion so a pathological formula
  (billion-laughs-style `\def` recursion) can't freeze the tab.
- `throwOnError: true` + per-block catch → localized fallback (EDGE-CASES.md).

### CSP as the backstop (defense in depth)

Served on every response by Express:

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self';                  ← no inline scripts anywhere in the app
  style-src 'self' 'unsafe-inline';   ← Tailwind is compiled; inline needed by KaTeX/Mermaid style attrs
  img-src 'self' data:;               ← KaTeX inline SVG data URIs
  connect-src 'self';
  object-src 'none'; base-uri 'none'; frame-ancestors 'none';
```

Even if a sanitizer bypass lands markup in the DOM, `script-src 'self'` with
no inline allowance means it does not execute. Consequence for the codebase:
**zero inline `<script>`/`onclick=` anywhere** — all listeners attached in JS.

---

## 3. SQL & FTS5 Injection Prevention

- All statements are prepared once with `better-sqlite3` and executed with
  bound parameters: `db.prepare('SELECT … WHERE id = ?').get(id)`. String
  concatenation into SQL is banned repo-wide (enforceable by grep in review:
  no template literals inside `prepare(...)`).
- **FTS5 `MATCH` is its own injection surface**: the right-hand side of
  `MATCH` is a *query language* (`AND`, `OR`, `NEAR`, `*`, `:` column
  filters). Raw user input like `"a AND` throws, and column-filter syntax can
  query columns we didn't intend. Mitigation: the server rewrites user input
  into quoted prefix tokens before binding —
  `q.split(/\s+/).filter(Boolean).map(t => '"' + t.replaceAll('"','""') + '"*').join(' ')` —
  so every token is a literal string, still bound as a parameter.
- Dynamic bits of SQL that cannot be parameters (sort column, direction) come
  from a hardcoded allowlist map, never from the request.
- JSON columns (`tags`, `urls`) are written via `JSON.stringify` server-side
  after schema validation (array of strings, length caps) — the DB never
  stores client-crafted raw JSON.

## 4. Server & Transport Hardening

| Control | Setting |
|---|---|
| Bind address | `app.listen(3000, '127.0.0.1')` — hard-coded, not env-overridable to `0.0.0.0` |
| Exposure | `tailscale serve` only (HTTPS w/ valid cert). No funnel. No router port-forward. |
| Body limits | `express.json({ limit: '2mb' })`; import route `multer`/raw cap 2 MB |
| Import validation | Extension allowlist (`.md`, `.markdown`) **and** content sniff (reject NUL bytes / binary); filename discarded — server generates the entry title from content, so path traversal via filename is moot; file buffered in memory, never written to disk |
| Headers | CSP (§ 2), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(), microphone=(), geolocation=()` |
| Static serving | `express.static(dist)` with `dotfiles: 'deny'`; no directory listing; API and DB files outside `dist/` |
| Cross-origin | No CORS headers at all → browsers block cross-origin reads; API is same-origin-only by default. No cookies → nothing for CSRF to ride. |
| Dependencies | Lockfile committed; `npm audit` in the build script; the 4 runtime libs (markdown-it, KaTeX, Mermaid, DOMPurify) vendored at pinned versions into `dist/vendor/` (CSP forbids CDNs anyway) |
| Tailscale hygiene | Key expiry left enabled; app host tagged; ACL restricting the serve port to the owner's devices; Tailnet lock optional |

## 5. Data Safety

- **WAL specifics**: `synchronous=NORMAL` is safe under WAL (worst crash case
  = last transaction lost, no corruption). Passive checkpoints are automatic;
  run `PRAGMA wal_checkpoint(TRUNCATE)` on graceful shutdown so backups see a
  compact single file.
- **Backups**: nightly `sqlite3 bento.db ".backup 'backups/bento-YYYYMMDD.db'"`
  (launchd job) — `.backup` is safe against a live WAL database, plain file
  copy is not (torn reads across `-wal`). Keep 14 rotations. Restore drill
  documented in the runbook before Phase B exit.
- **Migrations**: append-only numbered SQL files; runner records applied
  versions in `schema_migrations`; every migration runs inside a transaction;
  backup file is prerequisite to running a new migration.
- **localStorage drafts** are a crash buffer, not a store: never synced to
  the server without explicit user confirmation (restore prompt), cleared on
  successful save, and namespaced (`bento.draft.v1`) for future format changes.

## 6. Phase-D Audit Checklist (exit criteria)

- [ ] `grep` finds no `innerHTML`/`insertAdjacentHTML` outside `render/pipeline.js`
- [ ] `grep` finds no string interpolation inside `db.prepare(...)`
- [ ] CSP present on every response incl. errors; page functions with it (no inline script fallbacks snuck in)
- [ ] DOMPurify config matches § 2 verbatim; unit fixtures: `<img onerror>`, `<svg><foreignObject>`, `javascript:` link, `data:text/html` link, MathML `href` — all neutralized
- [ ] FTS smoke: search for `" OR 1=1 --`, `title:x`, `a AND` returns results or empty set, never 500
- [ ] Import: 3 MB file → 413; `.exe` renamed `.md` with NUL bytes → 400; huge single-line md → renders or degrades, no hang
- [ ] Server unreachable via LAN IP; reachable via `ts.net` HTTPS; Clipboard API works there
- [ ] Restore-from-backup drill performed once
- [ ] `/security-review` skill run on the branch with findings resolved

# Bento OS — Security Specification

> Companion documents: [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) · [EDGE-CASES.md](EDGE-CASES.md) · [UX-SPEC.md](UX-SPEC.md)
>
> **Status: describes the shipped, currently-running security posture on
> `main`** (Supabase/Postgres backend), including two real bugs found in
> production and how they were fixed (§ 2) — read those before touching
> the render pipeline, since both are the kind of mistake that's easy to
> reintroduce by "simplifying" the code.
>
> **Two backends, one doc.** `main` migrated off the SQLite/Express API to
> Supabase (Postgres + Auth + RLS) — `server/index.js` is now a static
> file host only, and `server/validate.js` / `server/db.js` no longer
> exist on this branch. The
> [`dev-local-auth`](../../tree/dev-local-auth) branch still runs the
> original SQLite/Express variant with real ownership of that code; where
> this doc describes SQLite/`better-sqlite3` specifics, that's the branch
> they apply to, called out explicitly. Everything about the render
> pipeline (§ 2) is identical on both, since it's pure client-side code
> shared by both variants.

---

## 1. Threat Model

Single trusted user (multi-account, but every account only ever sees its
own data), but the app renders rich untrusted-shaped content
(markdown → HTML/SVG/MathML) and is reachable from multiple devices —
either over a private tailnet/LAN (self-hosted, both variants) or via a
managed Supabase Cloud project (`main` only). Ranked risks:

| # | Threat | Vector | Likelihood | Impact | Primary control |
|---|---|---|---|---|---|
| 1 | **Stored XSS** | Imported `.md` files (pasted from the web), or own notes containing copied snippets, executing script on render | Medium | High (session-token theft — the Supabase JWT lives in `localStorage`, readable by any script that executes in-page, on every device that opens the note; see § 4) | DOMPurify choke point (§ 2) |
| 2 | **Mermaid/SVG injection** | `foreignObject`, `<script>` inside SVG, `javascript:` links in click bindings | Medium | High | Forbid-list + hand-rolled label extraction (§ 2) |
| 3 | **SQL / injection via the data API** | Search box, tag filters, any string reaching Postgres | Low (parameterized) | High | supabase-js parameterized calls + RLS (§ 3); prepared statements + FTS5 quoting on `dev-local-auth` |
| 4 | **Dynamic-fields injection** | Metadata field names/values crafted to smuggle structured data | Low | Low (plain-text-only by convention; see § 3) | Client-side type coercion rejects nested objects (§ 3) — note this is a UX guard, not a DB-enforced one, on `main` |
| 5 | **Compromised device / stolen session** | Stolen phone/laptop already on the tailnet or LAN, or a stolen `localStorage` JWT | Low | High | Tailscale ACLs, device expiry, no public bind by default (§ 4); Supabase session expiry on the cloud variant |
| 6 | **Data loss / corruption** | Crash mid-write, disk failure, bad migration | Medium | High | Postgres backups — managed (Supabase Cloud) or `pg_dump`/volume (self-hosted Docker) on `main`; WAL + `.backup` on `dev-local-auth` (§ 5) |
| 7 | **Malicious import file** | Oversized/binary/path-crafted upload | Low | Medium | Import validation, now client-side (§ 4) |

Explicit non-goals: rate limiting for abuse beyond Edge Function limits
(§ 4), CSRF tokens (no cookies — the JWT rides in an `Authorization`
header the browser never attaches automatically, so there's nothing for
a forged cross-origin request to ride).

---

## 2. XSS Mitigation — the render pipeline

**Invariant: exactly one function turns user text into DOM** —
`renderMarkdown()` / its `renderInto()` wrapper in `src/js/render.js` (see
IMPLEMENTATION-PLAN.md § 4). No other code path may assign user-derived
strings to `innerHTML`, `outerHTML`, or `insertAdjacentHTML`. UI chrome
built programmatically uses `textContent` / `createElement` only. This is a
grep-enforced invariant — see the checklist in § 6.

### Pipeline order (order matters)

```
markdown-it ({ html: false })          ← raw HTML in markdown is escaped, not passed through
  → custom inline rule: whitelist bare <sup>/<sub> only (see below)
  → transformTaskLists() / transformAlerts()  (DOM-tree transforms, no new markup sources)
  → KaTeX renderMathInElement (per-call try/catch)
  → Mermaid render (per-fence async, try/catch)
  → highlightCodeBlocks() (Prism.tokenize → createElement/textContent, no markup)
    → collapseForeignObjectLabels() (see below)
  → DOMPurify.sanitize(html, PURIFY_CONFIG)   ← LAST, so it sees final HTML
  → mount
```

Sanitizing **after** KaTeX/Mermaid is non-negotiable: sanitizing before
would both miss anything those libraries emit and break their output.

### DOMPurify configuration (`PURIFY_CONFIG` in `src/js/render.js`, current)

```js
{
  USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
  ADD_TAGS: ['semantics', 'annotation', 'input'],
  ADD_ATTR: ['aria-hidden', 'data-line', 'type', 'checked', 'disabled', 'id'],
  FORBID_TAGS: ['foreignObject', 'form', 'iframe', 'object', 'embed', 'base', 'link', 'meta', 'script'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'formaction'],
  // NOTE: no custom ALLOWED_URI_REGEXP — see "Lesson learned" below.
}
```

Plus a DOMPurify hook (`afterSanitizeAttributes`) that:
- adds `target="_blank" rel="noopener noreferrer"` to every kept **outbound**
  `<a href>` (notes link out to the web; no reverse-tabnabbing);
- marks `<a href="#…">` as an in-document anchor (`class="md-anchor"`, no
  `target`/`rel`) — a delegated click handler scrolls the rendered surface
  itself and always calls `preventDefault()`, so a hash link can neither open
  a tab nor rewrite the URL (EDGE-CASES § 4.12). Heading `id`s are slugs
  generated from `textContent`, so they carry no user markup;
- force-disables any surviving `<input type="checkbox">` and **removes**
  any other input type outright (task-list checkboxes are the only
  legitimate `<input>` this pipeline should ever emit).

**Why `foreignObject` is force-forbidden even though Mermaid emits it:**
`<foreignObject>` lets SVG embed arbitrary HTML — it is the classic
SVG-sanitizer bypass, and DOMPurify's own defense against it is to empty a
`foreignObject`'s contents wholesale rather than attempt to sanitize inside
one (allow-listing the tag via `ADD_TAGS` does **not** get its content
back — verified empirically; see the "Mermaid labels" lesson below). The
forbid-list stays in place unconditionally.

#### Lesson learned #1: a custom `ALLOWED_URI_REGEXP` blanked every Mermaid diagram

An earlier version of this config included:

```js
ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i   // intended to kill javascript:, data:, vbscript:
```

This was **removed**. It was redundant — DOMPurify's own default URI regex
already rejects `javascript:`/`data:`/`vbscript:` (anything that doesn't
match a known safe scheme or look like a schemeless/relative value) — and
it was actively harmful: DOMPurify applies whatever `ALLOWED_URI_REGEXP` is
configured to *any* attribute it inspects during URI validation, not just
`href`/`src`. That meant plain geometry attributes on SVG elements —
`viewBox`, `width="100%"` — failed the narrower regex (they don't start
with `https:`/`mailto:`) and were silently stripped, collapsing every
Mermaid diagram to a zero-size box. **Do not add a custom
`ALLOWED_URI_REGEXP` to this config** — the default is already correct and
well-vetted; verify that claim yourself in a browser console before
"tightening" it:

```js
DOMPurify.sanitize('<svg width="100%" viewBox="0 0 10 10">…</svg>',
  { ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i }); // → viewBox and width vanish
DOMPurify.sanitize('<a href="javascript:x()">y</a>'); // → href already stripped by the DEFAULT regex
```

#### Lesson learned #2: Mermaid labels need hand-rolled extraction, not an allow-list

Mermaid (the pinned `^11.6.0`) always renders node/edge/cluster label text
inside `<foreignObject><div>…<span class="nodeLabel">…</span></div></foreignObject>`
— **even** with `securityLevel: 'strict'` and `flowchart: { htmlLabels: false }`
set; that config option stopped having this effect in Mermaid's newer
renderer. Since `foreignObject` is (correctly) forbidden and DOMPurify
empties it wholesale rather than sanitizing inside it, the naive result is
diagrams that render as empty shapes with no visible text.

The fix, `collapseForeignObjectLabels()` in `render.js`, runs on the raw
Mermaid output **before** the final DOMPurify pass: for every
`foreignObject` it reads `.textContent` (which can carry no markup — text
nodes never execute, regardless of what elements produced them), builds a
plain SVG `<text>` positioned at the foreignObject's center, and drops the
foreignObject. `foreignObject` itself never leaves the forbid-list — this
function is the *only* path label text takes out of one, and that path is
provably inert. As extra defense-in-depth, it also strips any nested
`<script>`/`<style>` before reading `textContent`, so even if a future
Mermaid version regressed and let one through, its source could not surface
as visible label text.

**Accepted trade-off:** no HTML formatting (bold, links, line breaks) inside
Mermaid node labels — only plain text.

### Superscript / subscript: a narrow markdown-it whitelist, not the `^`/`~` extension

`render.js` pushes one custom inline rule onto `markdown-it`'s ruler that
recognizes **only** the literal four-byte sequences `<sup>`, `</sup>`,
`<sub>`, `</sub>` (regex `^<\/?(?:sup|sub)>` — no attributes, case-
insensitive) and passes them through as `html_inline` tokens. This is
deliberately **not** the markdown-it `^text^`/`~text~` superscript/
subscript plugin syntax: `^` is how KaTeX writes exponents inside `$…$`
math, so treating it as superscript markup outside of math would silently
corrupt formulas like `$a^2+b^2=c^2$`. Any `<sup>`/`<sub>` with an
attribute (`<sup onclick=…>`, `<sup class=…>`) does **not** match this
narrow rule and falls through to normal escaping — it renders as literal
text, not as a stripped-down element. DOMPurify (which already allows
`sup`/`sub` in its `html` profile) is still the final backstop underneath
this rule, not a replacement for it.

### Mermaid hardening

- `mermaid.initialize({ securityLevel: 'strict', startOnLoad: false })` —
  strict mode encodes HTML entities typed into diagram source and disables
  `click` callbacks/interactivity, which are script-execution vectors. (It
  does *not* prevent `foreignObject` labels — see above.)
- Diagrams render only through the pipeline (one `mermaid.render()` call
  per fence, inside the try/catch loop in `renderMarkdown()`); there is no
  auto-scan of the DOM.
- Render errors are caught per-fence; the fallback element (`errorChip()`)
  is built with `textContent` so the *error message itself* (which echoes
  user input) cannot inject. Mermaid's own global error-DOM element is
  explicitly cleaned up after each attempt (`document.getElementById('d' +
  id)?.remove()`), since strict mode can leave one behind on failure.

### KaTeX hardening

- `trust: false` (default) — blocks `\href`, `\includegraphics`,
  `\htmlClass` and other commands that emit URLs/HTML.
- `maxExpand: 1000` — caps macro expansion so a pathological formula
  (billion-laughs-style `\def` recursion) can't freeze the tab.
- `throwOnError: false` at the `renderMathInElement` call, with
  `errorColor` styling — a bad formula renders inline in red rather than
  throwing; the surrounding call is still wrapped in try/catch as a second
  layer (EDGE-CASES.md § 4).
- `ignoredTags: ['pre', 'code', 'script', 'style', 'textarea', 'option']` —
  the delimiter scan skips code content, so `` `$x$` `` in a code span is
  never mistaken for math (EDGE-CASES.md § 4.10).

### CSP as the backstop (defense in depth)

Served on every response by Express (`server/index.js`, current):

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'wasm-unsafe-eval';   ← 'wasm-unsafe-eval' is required by Mermaid's layout engine (WASM-based); no other exception
  style-src 'self' 'unsafe-inline';       ← Tailwind is compiled; inline needed by KaTeX/Mermaid inline style attributes
  img-src 'self' data:;                   ← KaTeX inline SVG/data URIs
  font-src 'self';
  connect-src 'self';
  object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none';
```

Plus `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
`Permissions-Policy: camera=(), microphone=(), geolocation=()`.

Even if a sanitizer bypass lands markup in the DOM, `script-src` with no
`unsafe-inline` for scripts means it does not execute. Consequence for the
codebase: **zero inline `<script>`/`onclick=` anywhere** — all listeners
attached in JS, and this CSP is tested against a real headless browser (not
just asserted) in the app's Playwright suites.

**Supabase variant — `connect-src` origin pinning.** The cloud build has to
let the browser reach its Supabase project, so `server/index.js` appends the
project's REST/Auth/Realtime origin to `connect-src` (e.g. `connect-src
'self' https://<ref>.supabase.co wss://<ref>.supabase.co`). That origin is
resolved most-specific-first: the `BENTO_SUPABASE_URL` environment variable,
else `SUPABASE_URL` read from `supabase-config.js` (the same value the
browser bundle uses, so a configured deploy is pinned to exactly one project
with no extra env setup), else a `https://*.supabase.co` wildcard that exists
only for an unconfigured fresh checkout. Deriving the origin from config
instead of defaulting to the wildcard keeps a real deployment from silently
permitting `fetch`/exfiltration to *any* Supabase project — the tightest
`connect-src` that still lets the app work.

---

## 3. Injection Prevention

### `main` (Supabase / Postgres)

There is no server-side SQL layer any more — `server/index.js` only
serves static files (§ 2's CSP note). The browser talks to Postgres
exclusively through `supabase-js` (`src/js/api.js`), which:

- Builds every query with the SDK's fluent filter API
  (`.eq()`, `.textSearch()`, …), which parameterizes internally — there is
  no path in this codebase that string-concatenates user input into SQL.
- **Row-Level Security is the real trust boundary, not this file.** Every
  policy in `supabase/migrations/20260714000001_init.sql` scopes
  `entries`/`prompts`/`snippets` to `user_id = auth.uid()` with **no**
  admin-read policy (`entries_select`, `prompts_select`, etc.) — so even a
  bug in `api.js` that leaked a raw filter can only ever touch the
  signed-in user's own rows; Postgres enforces this independent of
  anything the client sends.
- **Full-text search** uses Postgres `.textSearch('search', q, { type:
  'websearch', config: 'english' })` — `websearch` mode already parses
  its input as a restricted query language (quotes, `-`, `OR`) rather
  than raw `tsquery` syntax, so there's no `AND`/`NEAR`-style operator
  injection surface to begin with. `ftsClean()` in `src/js/api.js` still
  strips C0 control characters before the term reaches `.textSearch()`
  (most importantly the NUL byte, which cannot exist in a Postgres `text`
  value and would abort the request) — ported directly from the
  SQLite-era fix below, since the same NUL-crash class applies to
  Postgres.
- **`tags`/`urls`/`fields` are jsonb columns** — `api.js` passes real
  JS objects/arrays to supabase-js, which serializes them as parameters;
  the DB never receives a client-crafted raw JSON *string* to parse.
- **Dynamic fields specifically** (`normalizeFields()`, now in
  `src/js/normalize.js`): the `fields` value must be a plain object (an
  array is rejected, not coerced); a value that is itself an object or
  array is rejected with a `ValidationError` before the request is ever
  sent — so the UI can't smuggle a nested structure into what's meant to
  be flat plain-text metadata. Names are case-insensitive deduplicated
  (first occurrence wins) and capped at 64 fields per entry, values
  capped at 2000 characters.
  **Caveat, unlike the old server-side version of this check:** this now
  runs entirely in the browser, and unlike `title`/`body_md` (which carry
  a Postgres `check (length(btrim(...)) > 0)` constraint), the `fields`
  column has **no DB-level shape constraint** — it's a bare
  `jsonb not null default '{}'`. A request that bypasses `api.js` (e.g. a
  direct PostgREST call with a valid session) could write a nested value.
  This is a data-hygiene gap, not an injection one: the only place
  `fields` values reach the DOM is `logbook.js`'s
  `valueEl.value = value` (an `<input>` element's `.value` property),
  which coerces non-strings to their `String()` form rather than ever
  interpreting them as markup. Still, if `fields` gains a rendering path
  that assumes a string without coercion, revisit whether a DB `check`
  constraint (mirroring the client-side shape rule) is worth adding.

### `dev-local-auth` (SQLite / Express) — historical, kept for that branch

- All statements are prepared once with `better-sqlite3` and executed with
  bound parameters: `db.prepare('SELECT … WHERE id = ?').get(id)`. String
  concatenation into SQL is banned repo-wide (enforceable by grep — see § 6).
- **FTS5 `MATCH` is its own injection surface**: the right-hand side of
  `MATCH` is a *query language* (`AND`, `OR`, `NEAR`, `*`, `:` column
  filters). `server/validate.js`'s `ftsQuery()` rewrites user input into
  quoted prefix tokens before binding —
  `q.split(/\s+/).filter(Boolean).slice(0, 12).map(t => '"' + t.replace(/"/g,'""') + '"*').join(' ')` —
  so every token is a literal string, still bound as a parameter (also
  capped at 12 tokens, a minor DoS guard).
- **Control characters are stripped before the `MATCH` string is built.** A
  search term containing a NUL byte (`U+0000`) used to reach SQLite's FTS5
  parser, which reads the `MATCH` query as a C string: the embedded NUL
  terminated it mid-token and raised `SqliteError: unterminated string`,
  surfacing as an HTTP 500 on `GET /api/{entries,prompts,snippets}?q=…`.
  This was never injection — the value is bound as a parameter, so tables
  and per-user scoping were never at risk — but any user could crash their
  own search. `ftsQuery()` now maps every C0 control character to a space
  *before* tokenizing, so they behave as delimiters and never reach the
  `MATCH` expression. Found via penetration testing; the same fix was
  ported to `main`'s `ftsClean()` above.
- Dynamic bits of SQL that cannot be parameters (sort column, direction)
  come from a hardcoded allowlist, never from the request.
- **`tags`/`urls`/`fields`/prompt `tags` are all written via
  `JSON.stringify` server-side, after normalization** — the DB never
  stores client-crafted raw JSON strings.
- **Dynamic fields specifically** (`normalizeFields()` in `validate.js`):
  the request body's `fields` value must be a plain object (an array is
  explicitly rejected with 400, not coerced); each value must be a string,
  number, boolean, or `null` — **an object or array *value* is rejected
  with 400**, so a client can't smuggle a nested structure into what's
  meant to be flat plain-text metadata. Every surviving value is coerced
  through `String(value ?? '')` and trimmed before storage. Names are
  case-insensitive deduplicated (first occurrence wins) and capped at 64
  fields per entry. Unlike `main`, this check runs server-side, so it's a
  real enforcement boundary, not just a UX guard.

## 4. Server & Transport Hardening

`server/index.js` on `main` is a static file host only — no request body
is ever parsed server-side, since there's no `/api` to parse one for.

| Control | Setting |
|---|---|
| Bind address | `app.listen(PORT, HOST)` — `HOST` defaults to `127.0.0.1` but reads `BENTO_HOST` (Docker sets it to `0.0.0.0` *inside* the container so port-forwarding works; `docker-compose.yml`'s `${BENTO_BIND:-127.0.0.1}` still gates what's actually published on the host). `PORT` likewise defaults to `3000`, overridable via `BENTO_PORT`. **This is env-overridable by design now** — a self-hosted deploy that wants LAN/remote reach sets `BENTO_BIND=0.0.0.0` explicitly (see `DOCKER.md` § Exposing it); the safe default (loopback-only) is what a fresh checkout gets. |
| Exposure | Two supported paths: `tailscale serve` in front of the loopback-bound port (HTTPS w/ valid cert, no funnel, no router port-forward), or a plain LAN/`BENTO_BIND` exposure the operator opts into. Either way, the frontend itself carries no secrets — the real access boundary is Supabase Auth + RLS (§ 3), not network reachability. |
| Import validation | Runs **client-side only** now, in `parseMarkdownImport()` (`src/js/normalize.js`): extension allowlist (`.md`, `.markdown`), 2 MB size cap, NUL-byte rejection, and a replacement-char ratio check to reject mostly-binary content. This is a UX guard, not a trust boundary — there's no server in the loop to enforce it against a client that skips the UI; the actual defenses against a malicious imported file are the render pipeline (§ 2, which treats *all* content as untrusted regardless of source) and RLS (which still confines the write to the importing user's own rows). |
| Headers | CSP (§ 2), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(), microphone=(), geolocation=()` — set unconditionally by middleware ahead of `express.static`, so they're present on error responses too |
| Static serving | `express.static(dist)` with `dotfiles: 'deny'`; no directory listing; nothing sensitive lives under `dist/` (no DB file, no service-role key — those live in the Supabase project / edge function env, never shipped to the browser) |
| Cross-origin | This server sends no CORS headers → browsers block cross-origin reads of it. The session JWT lives in `localStorage` (not a cookie), so nothing rides automatically on a cross-origin request — there's no ambient credential for CSRF to exploit. (The Supabase project's own REST/Auth endpoints and Edge Functions set their own CORS policy — see § 4b.) |
| Dependencies | Lockfile committed; `npm run audit:deps` (`npm audit`) available; the runtime lib files (markdown-it, DOMPurify, KaTeX + its auto-render addon, Mermaid, Prism) vendored at pinned versions into `dist/vendor/` (CSP forbids CDNs anyway) |
| Tailscale hygiene | Applies to the self-hosted/Tailscale exposure path: key expiry left enabled; app host tagged; ACL restricting the serve port to the owner's devices; Tailnet lock optional |

## 4a. Service Worker & Offline Cache

The PWA service worker (`src/sw.js`, stamped into `dist/sw.js` by
`scripts/build-sw.js`) caches **the application, never the data**:

| Control | Setting |
|---|---|
| Scope | `/` — same-origin only. Cross-origin requests (every Supabase REST/Auth/Realtime call) return from the `fetch` handler *before* `respondWith`, so they are never read, stored or replayed by the worker. |
| Data layer | `/api/*` is skipped explicitly as well. Redundant on this (Supabase) variant, load-bearing on `dev-local-auth` where the Express API *is* same-origin — without it a `GET /api/entries` would put a signed-in user's rows into CacheStorage. The two variants share this file, so the rule lives here rather than in a branch. |
| What is cached | `index.html`, `assets/app.css`, the icons, `js/*.js` and `vendor/*` — files that are already public to anyone who can load the login page. No response carrying a user's rows or JWT ever enters CacheStorage. |
| Methods | GET only; a POST/PATCH/DELETE is never intercepted, so no write can be silently served from cache. |
| Cache naming | `bento-shell-<build>` / `bento-runtime-<build>`, where `<build>` is a SHA-256 of the precached bytes. A new build lands in new caches and `activate` deletes every other `bento-*` cache — a poisoned or stale generation cannot outlive one deploy. |
| Document strategy | Network-first: online, a deploy is picked up on the next load; the cached copy is a fallback, not the source of truth. |
| Update model | The incoming worker **waits** rather than calling `skipWaiting()` on its own — a running session with an unsaved draft is never swapped mid-edit. It takes over on the next launch. |
| Transport | Registration requires a secure context (HTTPS, or `localhost` for development) — over the Tailscale HTTPS serve this holds; over plain-HTTP LAN it silently no-ops and the app runs online-only. |

**Shared-device note:** the cache is app code only, so signing out leaves
nothing user-identifying in CacheStorage. The existing localStorage draft
buffer (§5) remains the only client-side store of user content, and its
rules are unchanged.

## 4b. Privileged Server-Side Actions — Supabase Edge Functions

RLS (§ 3) covers ordinary CRUD, but four actions need to bypass it by
design (creating a user, resetting another user's password, deleting a
user, deleting your own account) and so run as Deno Edge Functions under
the **service-role key**, in `supabase/functions/`:
`admin-create-user`, `admin-reset-password`, `admin-delete-user`,
`delete-account`.

- **Every function authenticates the caller itself** — `getCaller()`
  (`supabase/functions/_shared/mod.ts`) takes the `Authorization: Bearer`
  header, resolves it to a user via `auth.getUser(token)` (using the
  service client, so this check cannot be spoofed by a client-supplied
  claim), then loads that user's row from `user_roles`. A missing/invalid
  token or missing role row → `401`.
- **Role checks happen in the function, not the client.** `admin-delete-
  user` requires `caller.role === 'global_admin'` and separately blocks
  targeting yourself or another `global_admin` (RBAC §2 in the README:
  exactly one `global_admin`, enforced as a singleton at the DB level
  too) — a `403` either way, checked server-side where a client can't
  patch around it.
- **Per-caller rate limiting**: `withinRateLimit()` backs a fixed-window
  counter in `public.rate_limits` (service-role table), e.g.
  `admin-delete-user` caps deletes per admin per hour — bounds the blast
  radius of a compromised admin session.
- **CORS is `Access-Control-Allow-Origin: '*'`** on these functions —
  intentionally: authorization here is a bearer token the browser never
  attaches automatically (unlike a cookie), so a third-party origin
  can't ride an ambient credential; a wildcard doesn't hand out anything
  a caller couldn't already send directly with a token it had to obtain
  some other way (e.g. via XSS, which § 2 is the actual defense against).
- The service-role key itself never reaches the browser — it's an Edge
  Function/container environment variable only (README's "used only by
  those one-off admin scripts from your shell" note applies to the
  bootstrap script, not these functions, which run entirely server-side).

## 5. Data Safety

**On `main` (Supabase/Postgres), backup responsibility depends on which
of the two supported deployments you're running:**

- **Self-hosted Docker Postgres** (`docker-compose.yml`'s `db` service):
  **there is no managed backup** — the entire database is the `db-data`
  named volume on the host machine (`docker compose down -v` deletes it
  permanently; plain `down` keeps it). Take one with
  `docker compose exec db pg_dump -U supabase_admin -d postgres --clean
  --if-exists > bento-backup-$(date +%F).sql` and restore with `psql …
  < backup.sql` (see `DOCKER.md` § Backup & restore). No rotation is
  scheduled — that's a manual/cron responsibility, same as the SQLite
  variant always was.
- **Supabase Cloud**: backups are the hosted project's responsibility
  (point-in-time recovery / daily backups per your plan tier) — nothing
  in this repo manages that.

**On `dev-local-auth` (SQLite), unchanged from the original design:**

- **WAL specifics**: `synchronous=NORMAL` is safe under WAL (worst crash
  case = last transaction lost, no corruption). Passive checkpoints are
  automatic; the server runs `PRAGMA wal_checkpoint(TRUNCATE)` on graceful
  shutdown (`checkpointAndClose()` in `db.js`, wired to `SIGINT`/`SIGTERM`)
  so backups see a compact single file.
- **Backups**: `sqlite3 data/bento.db ".backup 'backups/bento-YYYYMMDD.db'"`
  — `.backup` is safe against a live WAL database; a plain file copy is not
  (torn reads across `-wal`). No automatic rotation is scheduled yet — this
  is a manual/cron responsibility, not something the app does itself.

**Migrations (applies to both variants, mechanism differs):**

- Append-only numbered SQL files in `server/migrations/` (`dev-local-auth`);
  the runner in `db.js` records applied versions in `schema_migrations` and
  runs each migration inside a transaction. **Back up before running a new
  migration** — migration 002 was a destructive one (it dropped columns
  and their data by design; see IMPLEMENTATION-PLAN.md § 8.1).
- **Deploying a migration — the step differs by backend, and getting it
  wrong ships client code against a schema that isn't there:**
  - *Local (SQLite) variant:* the `db.js` runner auto-applies any file in
    `server/migrations/` not yet in `schema_migrations` on the next server
    boot. Deploying the code deploys the schema — no manual step.
  - *Supabase variant:* files in `supabase/migrations/` are **not** applied
    automatically. After committing one, push it to the hosted project:
    `supabase link --project-ref <ref>` (once per checkout), then
    `supabase db push`, which applies only migrations missing from the
    remote's history. Skip it and the client queries a table the database
    doesn't have — PostgREST then returns *"Could not find the table
    'public.<name>' in the schema cache"* (the `snippets` table hit exactly
    this gap). Confirm with the read-only `supabase migration list`: the
    Local and Remote columns must match before the feature is really live.
- **localStorage drafts** are a crash buffer, not a store: never synced to
  the server without explicit user confirmation (the restore modal),
  cleared on successful save, and namespaced (`bento.draft.v1`) so a schema
  change can be detected and the old key discarded rather than
  misinterpreted.

## 6. Audit Checklist (run this after any change to the render/data layer)

- [ ] `grep -rn "innerHTML\|insertAdjacentHTML" src/js` finds no user-content assignment outside `render.js`
- [ ] On `dev-local-auth` only: `grep` finds no template-literal string interpolation inside any `db.prepare(...)` call
- [ ] CSP present on every response incl. error responses; the app still functions fully under it (no inline-script fallback snuck in)
- [ ] DOMPurify config has **no** custom `ALLOWED_URI_REGEXP` (see § 2 lesson #1) and still matches this doc otherwise
- [ ] Fixtures neutralized end-to-end in a real browser (not just unit-tested): `<img onerror>`, `<svg><foreignObject><script>`, `javascript:`/`data:` links, a `<sup onclick=…>` (must render as literal text, not a stripped element), a Mermaid node label containing `<img onerror=…>` (must render as either escaped text or nothing — never execute)
- [ ] A bare `<sup>2</sup>`/`<sub>2</sub>` still renders as a real element (regression check for lesson #2's sibling risk — over-tightening the sup/sub rule)
- [ ] A real Mermaid diagram with 2+ nodes renders with **visible label text**, not just shapes (regression check for lesson #2)
- [ ] FTS smoke: search for `" OR 1=1 --`, `title:x`, `a AND`, and a query containing a NUL byte (`U+0000`) each returns results or an empty set, never a 500/crash — via `.textSearch()` on `main`, via SQLite `MATCH` on `dev-local-auth` (regression check for the control-byte fix, § 3)
- [ ] `main`: calling `normalizeEntry({ fields: { a: { nested: 1 } } })` (`src/js/normalize.js`) throws `ValidationError`; same for `fields: ["not","an","object"]`. `dev-local-auth`: the equivalent `POST /api/entries` returns 400 for both.
- [ ] Import: `main` — a 3 MB `.md` file is rejected client-side with a toast (no network round-trip); a NUL-byte file renamed `.md` is rejected the same way; a huge single-line md renders or degrades without hanging the tab. `dev-local-auth` — same cases, but enforced server-side (3 MB → HTTP 413, NUL byte → 400).
- [ ] Server unreachable via LAN IP with default config; reachable via `ts.net` HTTPS, or via LAN if `BENTO_BIND` was deliberately set — confirm it matches what was actually intended for this deploy; Clipboard API works there
- [ ] Edge Functions (§ 4b): `admin-delete-user`/`admin-reset-password`/`admin-create-user` each 401 with no/garbage token, 403 for a non-`global_admin` caller, and the delete/self/other-`global_admin` guards still hold
- [ ] Restore-from-backup drill performed at least once (`pg_dump`/`psql` on `main`'s self-hosted Docker Postgres, `.backup` on `dev-local-auth`)
- [ ] After a build, DevTools → Application → Cache Storage contains **only** `bento-shell-<build>`/`bento-runtime-<build>`, and no entry under either is a Supabase URL (regression check for § 4a)

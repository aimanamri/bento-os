# Bento OS — Security Specification

> Companion documents: [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) · [EDGE-CASES.md](EDGE-CASES.md) · [UX-SPEC.md](UX-SPEC.md)
>
> **Status: describes the shipped, currently-running security posture**,
> including two real bugs found in production and how they were fixed
> (§ 2) — read those before touching the render pipeline, since both are
> the kind of mistake that's easy to reintroduce by "simplifying" the code.

---

## 1. Threat Model

Single trusted user, but the app renders rich untrusted-shaped content
(markdown → HTML/SVG/MathML) and is reachable from multiple devices over a
tailnet. Ranked risks:

| # | Threat | Vector | Likelihood | Impact | Primary control |
|---|---|---|---|---|---|
| 1 | **Stored XSS** | Imported `.md` files (pasted from the web), or own notes containing copied snippets, executing script on render | Medium | High (session on every tailnet device that opens the note) | DOMPurify choke point (§ 2) |
| 2 | **Mermaid/SVG injection** | `foreignObject`, `<script>` inside SVG, `javascript:` links in click bindings | Medium | High | Forbid-list + hand-rolled label extraction (§ 2) |
| 3 | **SQL / FTS5 injection** | Search box, tag filters, any string reaching SQL | Low (parameterized) | High | Prepared statements + FTS quoting (§ 3) |
| 4 | **Dynamic-fields injection** | Metadata field names/values crafted to smuggle structured data | Low | Low (plain-text-only storage; see § 3) | Server-side type coercion, rejects nested objects (§ 3) |
| 5 | **Compromised tailnet device** | Stolen phone/laptop already inside the tailnet | Low | High | Tailscale ACLs, device expiry, no public bind (§ 4) |
| 6 | **Data loss / corruption** | Crash mid-write, disk failure, bad migration | Medium | High | WAL + backups (§ 5) |
| 7 | **Malicious import file** | Oversized/binary/path-crafted upload | Low | Medium | Import validation (§ 4) |

Explicit non-goals: multi-user auth, rate limiting for abuse (single user
behind tailnet), CSRF tokens (no cookies/sessions — see § 4 on why the API
still isn't callable cross-origin).

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
  ADD_ATTR: ['aria-hidden', 'data-line', 'type', 'checked', 'disabled'],
  FORBID_TAGS: ['foreignObject', 'form', 'iframe', 'object', 'embed', 'base', 'link', 'meta', 'script'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'formaction'],
  // NOTE: no custom ALLOWED_URI_REGEXP — see "Lesson learned" below.
}
```

Plus a DOMPurify hook (`afterSanitizeAttributes`) that:
- adds `target="_blank" rel="noopener noreferrer"` to every kept `<a href>`
  (notes link out to the web; no reverse-tabnabbing);
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

---

## 3. SQL, FTS5, and Dynamic-Fields Injection Prevention

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
  fields per entry.

## 4. Server & Transport Hardening

| Control | Setting |
|---|---|
| Bind address | `app.listen(3000, '127.0.0.1')` — hard-coded, not env-overridable to `0.0.0.0` |
| Exposure | `tailscale serve` only (HTTPS w/ valid cert). No funnel. No router port-forward. |
| Body limits | `express.json({ limit: '2mb' })` |
| Import validation | Extension allowlist (`.md`, `.markdown`) **and** content sniff (reject NUL bytes / mostly-binary content via a replacement-char ratio check); filename discarded as an entry source — the title comes from the H1 or a sanitized/truncated filename string, never a filesystem path; content is held in a request-body string and never written to disk |
| Headers | CSP (§ 2), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(), microphone=(), geolocation=()` |
| Static serving | `express.static(dist)` with `dotfiles: 'deny'`; no directory listing; API and DB files (`data/`) live outside `dist/` |
| Cross-origin | No CORS headers at all → browsers block cross-origin reads; API is same-origin-only by default. No cookies → nothing for CSRF to ride. |
| Dependencies | Lockfile committed; `npm audit --omit=dev` script available; the 5 runtime lib files (markdown-it, DOMPurify, KaTeX + its auto-render addon, Mermaid) vendored at pinned versions into `dist/vendor/` (CSP forbids CDNs anyway) |
| Tailscale hygiene | Key expiry left enabled; app host tagged; ACL restricting the serve port to the owner's devices; Tailnet lock optional |

## 5. Data Safety

- **WAL specifics**: `synchronous=NORMAL` is safe under WAL (worst crash
  case = last transaction lost, no corruption). Passive checkpoints are
  automatic; the server runs `PRAGMA wal_checkpoint(TRUNCATE)` on graceful
  shutdown (`checkpointAndClose()` in `db.js`, wired to `SIGINT`/`SIGTERM`)
  so backups see a compact single file.
- **Backups**: `sqlite3 data/bento.db ".backup 'backups/bento-YYYYMMDD.db'"`
  — `.backup` is safe against a live WAL database; a plain file copy is not
  (torn reads across `-wal`). No automatic rotation is scheduled yet — this
  is a manual/cron responsibility, not something the app does itself.
- **Migrations**: append-only numbered SQL files in `server/migrations/`;
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
- [ ] `grep` finds no template-literal string interpolation inside any `db.prepare(...)` call
- [ ] CSP present on every response incl. error responses; the app still functions fully under it (no inline-script fallback snuck in)
- [ ] DOMPurify config has **no** custom `ALLOWED_URI_REGEXP` (see § 2 lesson #1) and still matches this doc otherwise
- [ ] Fixtures neutralized end-to-end in a real browser (not just unit-tested): `<img onerror>`, `<svg><foreignObject><script>`, `javascript:`/`data:` links, a `<sup onclick=…>` (must render as literal text, not a stripped element), a Mermaid node label containing `<img onerror=…>` (must render as either escaped text or nothing — never execute)
- [ ] A bare `<sup>2</sup>`/`<sub>2</sub>` still renders as a real element (regression check for lesson #2's sibling risk — over-tightening the sup/sub rule)
- [ ] A real Mermaid diagram with 2+ nodes renders with **visible label text**, not just shapes (regression check for lesson #2)
- [ ] FTS smoke: search for `" OR 1=1 --`, `title:x`, `a AND` returns results or an empty set, never a 500
- [ ] `POST /api/entries` with `fields: {"a": {"nested": 1}}` → 400; with `fields: ["not","an","object"]` → 400
- [ ] Import: 3 MB file → 413; NUL-byte content renamed `.md` → 400; huge single-line md → renders or degrades, no hang
- [ ] Server unreachable via LAN IP; reachable via `ts.net` HTTPS; Clipboard API works there
- [ ] Restore-from-backup drill performed at least once

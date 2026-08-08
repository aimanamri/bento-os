# Bento OS — Edge-Case Matrix

> Companion documents: [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) · [SECURITY.md](SECURITY.md) · [UX-SPEC.md](UX-SPEC.md)
>
> Format: every row is *case → required behavior*. Row numbers are stable —
> several are referenced directly in code comments (e.g. `src/js/prompts.js`
> cites `§5.1`/`§5.7`, `src/js/logbook.js` cites `§1.2`/`§3.3`/etc.) — so
> when a row's *mechanism* changes but its *outcome* doesn't, the row is
> reworded in place rather than renumbered or moved. New behavior that has
> no equivalent old row gets a new row at the end of its section, or a new
> numbered section (§9–§11) if it's a whole new feature area. Behaviors
> marked **(modal)** / **(banner)** / **(toast)** reference the UI patterns
> in UX-SPEC.md § 6.
>
> **Status**: this matrix is verified against the running app via the
> project's Playwright test suites (one per feature area — app-wide UI,
> prompt inline-editing, dynamic fields, modified-time, reading/editor
> mode, ribbon sup/sub/lists, plus a plain HTTP API suite), not just
> asserted from the plan.

---

## 1. Save & Close Guards (Docs LogBook)

| # | Case | Required behavior |
|---|---|---|
| 1.1 | Save with blank title or blank body (incl. whitespace-only) | Block save. **(modal)** "Entry needs a title and details." Focus the offending field. Server independently returns 400 (DB `CHECK` is the last line). |
| 1.2 | Close `[x]` with unsaved modifications | **(modal)** Save / Discard / Cancel — three explicit choices, never a two-button ambiguous "OK/Cancel". |
| 1.3 | Browser tab close / refresh while dirty | `beforeunload` handler returns a prompt string. Registered **only while dirty** (a permanently registered handler breaks bfcache and annoys). |
| 1.4 | Switching Bento tabs (LogBook → Prompt Library) while dirty | Allowed without prompt — editor state is kept alive in the DOM (tabs hide, not unmount). Dirty indicator remains on the LogBook tab label. |
| 1.5 | "New Entry" clicked while current entry is dirty | Same guard as 1.2. Also switches the workspace to Editor mode (§ 9.2) once the guard clears. |
| 1.6 | Title exactly at boundary: 1 char, or extremely long (500+ chars) | 1 char saves. Enforce max 300 chars client+server (sidebar truncates with ellipsis + full title in `title` attr). |

## 2. Autosave & Draft Restore

| # | Case | Required behavior |
|---|---|---|
| 2.1 | 10 s tick fires while editor is clean | Skip the write entirely (don't churn localStorage). |
| 2.2 | Crash/refresh with draft present, draft is for an **existing** entry | On boot: if `draft.savedAt > entry.updated_at` → **(modal)** "Restore unsaved draft from HH:MM?" with side-by-side timestamps. If server row is newer than draft (edited on another device since), say so explicitly and default-select the server version. |
| 2.3 | Draft present for a **new, never-saved** entry | **(modal)** restore prompt; discard permanently deletes the draft key. |
| 2.4 | User declines restore | Delete the draft key immediately — never re-prompt for the same draft. Workspace opens in Reading mode if a server version exists (§ 9.2). |
| 2.5 | localStorage quota exceeded (huge note) | Catch `QuotaExceededError`; **(toast)** "Auto-backup paused — note too large"; keep last successful draft; retry each tick. Never crash the tick loop. |
| 2.6 | localStorage unavailable (private mode / disabled) | Detect at boot with a write probe; disable autosave; **(toast)** once per session. App remains fully functional. |
| 2.7 | Autosave tick during an in-flight manual save | Manual save completion clears the draft *after* the server 200 — ordering guaranteed by clearing inside the save promise, not in the tick. |
| 2.8 | Draft schema from an older app version | Key is versioned (`bento.draft.v1`); unknown/missing version → discard silently. |
| 2.9 | Draft carries a hand-edited Modified time | The draft snapshot includes the raw `<input>` value plus a `_modifiedEdited` flag; restoring the draft restores both, so a manually-set Modified time survives a crash (§ 11). |

## 3. Multi-Device / Tailscale Sync

| # | Case | Required behavior |
|---|---|---|
| 3.1 | `focus` event, editor **clean** | Refetch entry list + currently open entry. Debounced: at most once per 30 s. |
| 3.2 | `focus` event, editor **dirty** | **Never clobber.** Skip content refetch; fetch list metadata only; if the open entry's `updated_at` changed on the server → **(banner)** "This entry was updated on another device" with \[Review] (opens read-only server copy alongside) and \[Keep mine]. |
| 3.3 | `PUT` with stale `expected_updated_at` | Server returns **409**. Client shows conflict **(modal)**: "Saved on another device at HH:MM" → \[Overwrite] \[Copy mine & load theirs] \[Cancel]. Overwrite is an explicit second click, never default. This still fires correctly even when Modified time is manually edited — the concurrency token is always the in-memory `updated_at`, never reconstructed from the editable datetime field (§ 11). |
| 3.4 | Two devices, both dirty, both save | First wins normally; second hits 3.3. Acceptable for single-user; no merge machinery. |
| 3.5 | Network drop mid-save (tailnet roaming, laptop asleep) | `fetch` timeout 10 s → **(toast)** "Couldn't reach Bento host — draft is safe locally"; dirty state and draft retained; retry button. |
| 3.6 | Server restarted / schema migrated between visits | `GET /api/health` on boot returns schema version; mismatch with cached client → hard reload prompt. |
| 3.7 | Laptop host asleep when phone connects | Same as 3.5 (connection refused) — friendly host-unreachable screen, not a blank page. |
| 3.8 | Installed PWA launched with **no network**, session still valid | The service worker serves the cached shell, so the app boots to its normal layout rather than a browser error page. The offline chip in the title bar appears immediately (`navigator.onLine`, not after the 10 s request timeout). Entries/prompts/snippets are **not** cached — lists render empty and each read reports the usual NETWORK error. |
| 3.9 | Installed PWA launched offline, session cookie expired | The session cannot be re-established without the host, so the login screen shows. Signing in requires connectivity — this is the one offline state the app cannot paper over, and it must fail with the normal auth error rather than hanging. |
| 3.10 | New build deployed while a tab is open | The incoming worker installs and waits; a toast says the update applies at next launch. The running session is never swapped mid-edit, so an unsaved draft cannot be lost to a deploy. |
| 3.11 | Connectivity returns while the app is open | The `online` event re-runs the health check immediately (the 60 s poll is only a backstop), clearing the offline chip without a reload. |

## 4. Rendering (Markdown / KaTeX / Mermaid)

| # | Case | Required behavior |
|---|---|---|
| 4.1 | Invalid LaTeX (`$\frac{1}$`) | Per-block catch → inline fallback chip: ⚠ "LaTeX error" + original source in monospace (via `textContent`). Rest of document renders normally. |
| 4.2 | Invalid Mermaid syntax | Same pattern: fenced block replaced by warning card with the raw source preserved. Mermaid's own error DOM is suppressed (it injects a global error div by default — must be disabled). |
| 4.3 | Pathological KaTeX (recursive `\def`, 10k-char formula) | `maxExpand: 1000` throws → 4.1 path. No tab freeze. |
| 4.4 | Very large document (1 MB+, 10k lines) | Preview re-render debounced 300 ms after last keystroke (extends to ~1.2 s if the previous render took > 600 ms — an adaptive backoff); must not block typing. |
| 4.5 | Giant table / deeply nested lists / 10k-item list | Must render without layout break; preview pane scrolls horizontally within itself (never the page). |
| 4.6 | `<script>alert(1)</script>` typed in a note | Escaped by `markdown-it {html:false}`, displayed as literal text. (Security fixture — SECURITY.md § 6.) |
| 4.7 | Unclosed code fence at end of document | Renders as code to EOF (CommonMark behavior) — acceptable; no error. |
| 4.8 | Mermaid fence empty or whitespace-only | Skip render, show nothing (no error chip for empty input). |
| 4.9 | Checkbox lists in preview | Rendered checkboxes are display-only (clicking does not mutate source). Cursor: default, not pointer — don't imply interactivity. |
| 4.10 | Math delimiters inside code spans/fences (`` `$x$` ``) | Must NOT be KaTeX-rendered — `ignoredTags` on the auto-render call skips `pre`/`code`/etc. |
| 4.11 | `<sup>2</sup>` / `<sub>2</sub>` typed literally in a note | Renders as a real superscript/subscript element — but **only** the bare tag (no attributes); `<sup class=… onclick=…>` does not match the whitelist rule and renders as literal escaped text instead (SECURITY.md § 2). Math like `$a^2+b^2$` is entirely unaffected — the `^`/`~` markdown-it superscript/subscript *syntax* was deliberately never enabled. |
| 4.12 | In-document link (`[Setup](#setup-steps)`) | Scrolls the rendered surface to that heading **in place** — same tab, and `location.hash` is never written (the note is not a routable page). Headings get GitHub-style slug `id`s (duplicates → `-1`, `-2`); a link whose target does not exist is swallowed (no navigation, no URL change). The landed-on heading flashes briefly, since the URL gives no feedback. Modifier/middle clicks are left to the browser. |
| 4.13 | Mermaid diagram with 2+ node/edge labels | All label text must be visible (not blank shapes) — labels are extracted from Mermaid's `foreignObject` output into plain SVG `<text>` before sanitization (SECURITY.md § 2). HTML formatting *inside* a label (bold, links) is not supported — it renders as flattened plain text, which is an accepted trade-off, not a bug. |

## 5. Prompt Library — `{{Variable}}` Engine (directly editable in place)

Variable grammar: `\{\{\s*([^{}]+?)\s*\}\}` — single scan, no recursion.
**There is no "Fill In and Copy" toggle button and no separate list of
`<input>` fields below the card** — each `{{Variable}}` occurrence renders
as a `contenteditable` span directly inside the prompt body text, always
editable, no mode switch required.

| # | Case | Required behavior |
|---|---|---|
| 5.1 | Duplicate variable (`{{Topic}}` twice) | Editing **either** occurrence's inline slot live-mirrors the same text into every other slot with that variable name — except the slot currently focused (its own caret/selection is never disturbed by the mirror update). |
| 5.2 | Empty braces `{{}}` / whitespace-only `{{ }}` | Not a variable — left as literal text. |
| 5.3 | Names with spaces & specials (`{{Programming Language}}`, `{{X (v2)}}`) | Valid. Name is matched literally (regex-escaped when substituting), label shown verbatim. |
| 5.4 | Nested/adjacent braces `{{{{A}}}}`, `{{A}}{{B}}` | Non-greedy inner match: `{{{{A}}}}` yields variable `{{A}}`'s outer braces literal + inner var (documented in the Guide); `{{A}}{{B}}` = two variables. No infinite loops. |
| 5.5 | Unclosed `{{Topic` | Literal text, no dangling slot. |
| 5.6 | Variable inside a code fence in the prompt body | Still a variable — prompt bodies are plain text, not markdown-rendered, so there's no code-fence concept to except it from. (Explicitly documented in the Guide.) |
| 5.7 | A slot is cleared to empty and loses focus (blur) | Reverts the slot's displayed text back to the literal placeholder (`{{Name}}`) and removes it from the values map — **Copy never produces blank text for a cleared variable**, it falls back to the placeholder, same as an untouched one. |
| 5.8 | Typing in a slot | Every keystroke updates that slot's entry in the in-memory values map immediately (`input` event) — "Copy" always reads the current map, so it's never stale relative to what's on screen. |
| 5.9 | Clipboard API unavailable (non-secure ctx) or permission denied | Fallback: select-the-text + `execCommand('copy')`; if that fails, **(modal)** with the final text in a `<textarea>` for manual copy. Always a path to the text. |
| 5.10 | Copy success/failure feedback | Button morphs to "✓ Copied" 1.5 s / **(toast)** on failure. |
| 5.11 | Prompt body with 20+ variables | The monospace prompt-body well itself scrolls (max-height clamp) — there is no separate input list to manage, so the well's own scroll is the only overflow concern. |
| 5.12 | Pasting into a variable slot | Forced to plain text (`clipboardData.getData('text/plain')`, whitespace/newlines collapsed to single spaces, inserted via `execCommand('insertText', …)`) — rich text pasted from elsewhere can never leave stray formatting nodes inside a slot. |
| 5.13 | Pressing Enter while focused in a slot | Blocked (`preventDefault`) — variable values stay single-line; Enter cannot fragment a slot's content across lines. |
| 5.14 | First click/focus into a slot vs. a second click to reposition the caret | **First** focus-in selects the slot's entire content (so typing replaces the whole placeholder in one motion, like a normal form field). A **second** click while already focused behaves like a normal text field — places the caret at the click point, does not re-select everything. |

## 6. Input Hygiene & Data

| # | Case | Required behavior |
|---|---|---|
| 6.1 | Tags: `"a,, b , a ,"` | Normalize: split, trim, drop empties, case-insensitive dedupe → `["a","b"]`. Same normalization server-side. |
| 6.2 | Tag containing a comma | Impossible by construction (comma is the delimiter) — Guide documents it; input strips them. |
| 6.3 | Labels blank | Map to `Uncategorized` (client default + DB `DEFAULT`). Sub-label without label → also `Uncategorized/`+sublabel is forbidden; sublabel select disabled until label chosen. |
| 6.4 | URL list: `"https://a.com, not a url, ftp://x"` | Parse per-item; valid `http(s)` items become link chips (one per row, scheme stripped for width, wrapping to at most 2 lines, full value in the tooltip and `href`); invalid items kept as a warning-toned chip with a ⚠ icon — never silently dropped (they may be paths/notes). The chips render **outside** the `<details>`, so collapsing the comma-separated editor hides the raw text but never the links; the summary carries a link-count badge. |
| 6.5 | Search: `" OR 1=1 --`, `title:x`, lone `"` | Safe (SECURITY.md § 3 quoting); returns literal-match results or empty; never 500. |
| 6.6 | Search with 0 results | Empty state with the query echoed (safely) + "Clear search" action. |
| 6.7 | Unicode: emoji in titles/tags, CJK, RTL text | Stored and searched correctly (FTS `unicode61`); no mojibake; RTL renders with `dir="auto"` on title/body containers. |
| 6.8 | SQLITE_BUSY under concurrent write (two devices) | `busy_timeout=5000` absorbs it; if still busy → 503 with retry-after; client toast + auto-retry once. |
| 6.9 | Entry deleted on device A while open on device B | B's next save → 404 → **(modal)** "This entry was deleted elsewhere" with \[Save as new entry] \[Discard]. |

## 7. Markdown Import

| # | Case | Required behavior |
|---|---|---|
| 7.1 | Happy path `.md` with `# H1` first | Title ← H1 (stripped from body); body ← rest; success **(toast)** + entry opens in Reading mode (§ 9.2). |
| 7.2 | No H1 anywhere | Title ← filename sans extension (sanitized, ≤300 chars). |
| 7.3 | File > 2 MB | 413 → **(modal)** with the limit stated. |
| 7.4 | Wrong type (`.txt`, `.docx`, binary renamed `.md`) | Extension check first; then NUL-byte/content sniff → 400 "Not a markdown file". |
| 7.5 | BOM, CRLF, mixed encodings | Strip BOM; normalize CRLF→LF; decode as UTF-8 with replacement chars (never crash on invalid bytes). |
| 7.6 | Frontmatter (`--- yaml ---`) | Kept verbatim in body (no parsing). Documented in Guide. |
| 7.7 | Import while editor is dirty | Same guard as 1.2 before replacing the workspace. |
| 7.8 | Duplicate import (same content twice) | Allowed — creates a second entry (no dedup magic); user deletes if unwanted. |

## 8. Environment & Platform

| # | Case | Required behavior |
|---|---|---|
| 8.1 | `backdrop-filter` unsupported (older browser) | `@supports` fallback: solid translucent panels — legible, just not glassy. |
| 8.2 | Fullscreen API rejected (iOS Safari on iPhone) | Green light hides or no-ops with **(toast)** "Fullscreen not supported here". |
| 8.3 | Viewport < 400 px (phone over tailnet) | Editor/preview toggle mode within Editor mode (UX-SPEC § 3, § 9); ribbon horizontally scrollable; traffic lights remain tappable ≥ 44 px targets. |
| 8.4 | `prefers-reduced-motion` | All transitions (focus mode collapse, card flip, dock) drop to instant state changes. |
| 8.5 | System clock skew between devices | Conflict copy (3.2/3.3) shows both timestamps but decisions compare **server** `updated_at` values only — client clocks are never compared against server clocks. Manually editing Modified time (§ 11) is a deliberate exception the user opts into per-entry; it does not affect how *conflicts* are detected. |
| 8.6 | Two browser tabs open on the same device | They behave as two devices (3.x rows apply). Draft key collision: last dirty tab wins the draft slot — acceptable, documented. |
| 8.7 | Metadata panel toggled open on a phone | Renders as a right-edge overlay sheet (scrim, close button, Esc, swipe-right), never as an in-flow column — in flow its `w-72` takes 288 of ~390 px and the workspace collapses until the entry header stacks vertically. Crossing the 1024 px line while it is open (rotation) re-resolves it into the form that fits rather than leaving a fixed sheet over a roomy layout. |

## 9. Reading / Editor Mode

The LogBook workspace has two modes, tracked as `#lb-workspace[data-mode]`
(`"read"` or `"edit"`), toggled by a single icon button in the entry
header. This section did not exist in the original plan — see
IMPLEMENTATION-PLAN.md § 8.5.

| # | Case | Required behavior |
|---|---|---|
| 9.1 | Toggle button, hover | Native `title` attribute shows the mode-appropriate label ("Reading mode — click to edit" / "Editor mode — click to read") — no separate tooltip widget, so it works identically with mouse hover, and its content is available to assistive tech via the element's accessible name path. |
| 9.2 | Default mode per entry point | Open existing entry → Reading. "New Entry" → Editor. Markdown import → Reading (review what was imported). Restore an unsaved draft → Editor. Decline a draft restore (server version loads) → Reading. |
| 9.3 | Switching to Editor mode | Focuses the markdown `<textarea>` immediately — no extra click needed to start typing. |
| 9.4 | Switching to Reading mode | Preview re-renders immediately if content changed since the last render (does not rely on a stale cached preview). |
| 9.5 | Reading mode layout | Only the rendered preview is shown, constrained to a ~46rem reading measure and centered — not stretched to the full pane width. Summary section, Body section header, formatting ribbon, editor pane, and the editor/preview divider are all hidden (not just visually — `display: none`, so they're out of the tab order too). |
| 9.6 | Metadata panel visibility across modes | Unaffected by Reading/Editor mode — Label, Tags, Fields, Created/Modified, and URL list all stay visible and editable in either mode. Reading/Editor mode only concerns the body-authoring chrome, not metadata. (Closed mode is the exception — see § 9.9.) |
| 9.7 | Editing content, then switching to Reading without saving | Allowed — Reading mode shows the current (possibly unsaved/dirty) in-memory content, not the last-saved version. The dirty indicator is unaffected by mode. |
| 9.8 | Narrow-viewport Write/Preview toggle (§ 8.3) interaction | That toggle only exists and matters *within* Editor mode (it switches which half of the split view is visible on a narrow screen); it plays no role in Reading mode, where there is no split to toggle. |
| 9.9 | Closing an entry (× in the entry header) | Passes through the unsaved-changes guard (§ 1.2), then lands in **Closed** mode: no entry is open, so every per-entry control is `display: none` — title, dirty hint, mode toggle, Save, metadata toggle, the × itself, Summary, Body header, ribbon, and the split — *and* the metadata panel, which is a sibling of the workspace rather than a child. What remains is the sidebar (and its toggles) plus a centered reactive face card and a "New Entry" button. The form behind it is reset, so the next new entry starts clean, and no sidebar row is marked active. |
| 9.10 | Closed mode, incidental interactions | ⌘S / Ctrl+S is a no-op (nothing to save — the key is handed back to the browser rather than opening the blank-entry modal). If the metadata sheet (§ 8.7) was open on a narrow screen, closing dismisses it — otherwise its `<body>`-level scrim would outlive the panel that CSS just hid. Leaving Closed mode happens by opening a sidebar row (→ Reading) or by "New Entry" from either the sidebar or the empty state (→ Editor). |

## 10. Dynamic Metadata Fields (`entries.fields`)

Replaces a fixed OS-Platform dropdown + `isValid` checkbox from the
original plan — see IMPLEMENTATION-PLAN.md § 8.1 for why. Each entry has an
arbitrary, user-defined set of plain-text name/value pairs, edited as rows
in the metadata panel.

| # | Case | Required behavior |
|---|---|---|
| 10.1 | Add a field with a blank name | Rejected client-side with an inline error message; the name input is refocused. Nothing is added. |
| 10.2 | Add a field whose name already exists on this entry (case-insensitive: `OS_Platform` vs `os_platform`) | Rejected with an inline error naming the conflicting field; existing field is left untouched. |
| 10.3 | Add a field via the Add button vs. pressing Enter in either the name or value input | Both work identically. |
| 10.4 | Delete a field | Removes its row immediately (client) and is persisted on next save; if it was the last field, the "No fields yet" empty-state hint reappears. |
| 10.5 | Edit an existing field's value | Marks the entry dirty like any other field edit; no special-casing vs. title/body/tags. |
| 10.6 | Field name / value length & count | Server caps: name ≤ 64 chars, value ≤ 2000 chars, ≤ 64 fields per entry — enforced independently of client-side limits (never trust the client alone). |
| 10.7 | Field value that looks like an object/array (sent directly via the API, bypassing the UI) | Server rejects with 400 if the *value* is a nested object or array — fields are plain-text-only by design, not a general JSON store (SECURITY.md § 3). |
| 10.8 | Field name-suggestion datalist | Populated from field names already used on *other* entries (not the one currently open), so recurring conventions (`os_platform`, `is_valid`) are easy to reapply without retyping. |
| 10.9 | Searching for a field's value from the sidebar (e.g. typing `macOS`) | Matches, because `fields` is indexed into `entries_fts` as raw JSON text (FTS5 tokenizes on word boundaries regardless of the surrounding JSON punctuation). |
| 10.10 | An entry with zero fields | Metadata panel shows an explicit "No fields yet — add one below…" hint rather than an empty, ambiguous space. |

## 11. Editable Modified Time (`entries.updated_at`)

`Created` remains fully read-only/immutable (DB trigger, unchanged from
the original plan). `Modified` — previously purely server-managed — is now
user-editable via a `datetime-local` input. See
IMPLEMENTATION-PLAN.md § 8.3.

| # | Case | Required behavior |
|---|---|---|
| 11.1 | Normal save, Modified field untouched | Server auto-bumps `updated_at` to "now", same as before this feature existed. |
| 11.2 | User hand-edits the Modified field, then saves | The exact value entered is sent as `updated_at` and stored verbatim (not adjusted, not merely used as a hint). |
| 11.3 | A plain save (no Modified edit) *after* a previous manual override | Auto-bumps to "now" again — a manual override affects only the save it was set for, it does not "stick" as a permanent auto-bump override. |
| 11.4 | Editing the Modified field | Marks the entry dirty, same as any other field. |
| 11.5 | Malformed/negative/non-numeric `updated_at` sent to the API directly | Rejected 400 — server requires a positive finite number when the field is present at all; omitting it entirely is the normal (auto-bump) path. |
| 11.6 | Concurrency/conflict detection (§ 3.3) after this feature | Unaffected — the token compared is always the in-memory `state.current.updated_at` at full millisecond precision, never reconstructed from the second-precision `datetime-local` field's displayed value. |
| 11.7 | `Created` field | Never becomes an `<input>` — stays a read-only `<span>` labeled "(read-only)". No client or server code path can change it once set; the DB trigger is the backstop even if a client bug tried. |
| 11.8 | Reloading the page / reopening the entry after a manual Modified edit | The manually-set value persists and re-populates the field exactly (round-trips through the server, not just cached client-side). |

---

## Verification

This matrix is exercised by hand-written Playwright test suites (one file
per feature area) plus a plain-HTTP API suite, run against a live instance
of the app in a real headless browser — not just asserted from this
document. If you're reproducing this project, treat each row above as a
test case to write, not just a design note to read.

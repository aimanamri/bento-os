# Bento OS — Edge-Case Matrix

> Companion documents: [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) · [SECURITY.md](SECURITY.md) · [UX-SPEC.md](UX-SPEC.md)
>
> Format: every row is *case → required behavior*. Each row becomes a manual
> test in the Phase B/C exit checklist; behaviors marked **(modal)** /
> **(banner)** / **(toast)** reference the UI patterns in UX-SPEC.md § 6.

---

## 1. Save & Close Guards (Docs LogBook)

| # | Case | Required behavior |
|---|---|---|
| 1.1 | Save with blank title or blank body (incl. whitespace-only) | Block save. **(modal)** "Entry needs a title and details." Focus the offending field. Server independently returns 400 (DB `CHECK` is the last line). |
| 1.2 | Close `[x]` with unsaved modifications | **(modal)** Save / Discard / Cancel — three explicit choices, never a two-button ambiguous "OK/Cancel". |
| 1.3 | Browser tab close / refresh while dirty | `beforeunload` handler returns a prompt string. Registered **only while dirty** (a permanently registered handler breaks bfcache and annoys). |
| 1.4 | Switching Bento tabs (LogBook → Prompt Library) while dirty | Allowed without prompt — editor state is kept alive in the DOM (tabs hide, not unmount). Dirty indicator remains on the LogBook tab label. |
| 1.5 | "New Entry" clicked while current entry is dirty | Same guard as 1.2. |
| 1.6 | Title exactly at boundary: 1 char, or extremely long (500+ chars) | 1 char saves. Enforce max 300 chars client+server (sidebar truncates with ellipsis + full title in `title` attr). |

## 2. Autosave & Draft Restore

| # | Case | Required behavior |
|---|---|---|
| 2.1 | 10 s tick fires while editor is clean | Skip the write entirely (don't churn localStorage). |
| 2.2 | Crash/refresh with draft present, draft is for an **existing** entry | On boot: if `draft.savedAt > entry.updated_at` → **(modal)** "Restore unsaved draft from HH:MM?" with side-by-side timestamps. If server row is newer than draft (edited on another device since), say so explicitly and default-select the server version. |
| 2.3 | Draft present for a **new, never-saved** entry | **(modal)** restore prompt; discard permanently deletes the draft key. |
| 2.4 | User declines restore | Delete the draft key immediately — never re-prompt for the same draft. |
| 2.5 | localStorage quota exceeded (huge note) | Catch `QuotaExceededError`; **(toast)** "Auto-backup paused — note too large"; keep last successful draft; retry each tick. Never crash the tick loop. |
| 2.6 | localStorage unavailable (private mode / disabled) | Detect at boot with a write probe; disable autosave; **(toast)** once per session. App remains fully functional. |
| 2.7 | Autosave tick during an in-flight manual save | Manual save completion clears the draft *after* the server 200 — ordering guaranteed by clearing inside the save promise, not in the tick. |
| 2.8 | Draft schema from an older app version | Key is versioned (`bento.draft.v1`); unknown/missing version → discard silently. |

## 3. Multi-Device / Tailscale Sync

| # | Case | Required behavior |
|---|---|---|
| 3.1 | `focus` event, editor **clean** | Refetch entry list + currently open entry. Debounced: at most once per 30 s. |
| 3.2 | `focus` event, editor **dirty** | **Never clobber.** Skip content refetch; fetch list metadata only; if the open entry's `updated_at` changed on the server → **(banner)** "This entry was updated on another device" with \[Review] (opens read-only server copy alongside) and \[Keep mine]. |
| 3.3 | `PUT` with stale `expected_updated_at` | Server returns **409**. Client shows conflict **(modal)**: "Saved on another device at HH:MM" → \[Overwrite] \[Copy mine & load theirs] \[Cancel]. Overwrite is an explicit second click, never default. |
| 3.4 | Two devices, both dirty, both save | First wins normally; second hits 3.3. Acceptable for single-user; no merge machinery. |
| 3.5 | Network drop mid-save (tailnet roaming, laptop asleep) | `fetch` timeout 10 s → **(toast)** "Couldn't reach Bento host — draft is safe locally"; dirty state and draft retained; retry button. |
| 3.6 | Server restarted / schema migrated between visits | `GET /api/health` on boot returns schema version; mismatch with cached client → hard reload prompt. |
| 3.7 | Laptop host asleep when phone connects | Same as 3.5 (connection refused) — friendly host-unreachable screen, not a blank page. |

## 4. Rendering (Markdown / KaTeX / Mermaid)

| # | Case | Required behavior |
|---|---|---|
| 4.1 | Invalid LaTeX (`$\frac{1}$`) | Per-block catch → inline fallback chip: ⚠ "LaTeX error" + original source in monospace (via `textContent`). Rest of document renders normally. |
| 4.2 | Invalid Mermaid syntax | Same pattern: fenced block replaced by warning card with the raw source preserved. Mermaid's own error DOM is suppressed (it injects a global error div by default — must be disabled). |
| 4.3 | Pathological KaTeX (recursive `\def`, 10k-char formula) | `maxExpand: 1000` throws → 4.1 path. No tab freeze. |
| 4.4 | Very large document (1 MB+, 10k lines) | Preview re-render debounced 300 ms after last keystroke; render runs full-document (no virtualization in Phase 1) but must not block typing — if render exceeds ~200 ms budget, show "Preview paused for large doc" with manual refresh affordance. |
| 4.5 | Giant table / deeply nested lists / 10k-item list | Must render without layout break; preview pane scrolls horizontally within itself (never the page). |
| 4.6 | `<script>alert(1)</script>` typed in a note | Escaped by `markdown-it {html:false}`, displayed as literal text. (Security fixture — SECURITY.md § 6.) |
| 4.7 | Unclosed code fence at end of document | Renders as code to EOF (CommonMark behavior) — acceptable; no error. |
| 4.8 | Mermaid fence empty or whitespace-only | Skip render, show nothing (no error chip for empty input). |
| 4.9 | Checkbox lists in preview | Rendered checkboxes are display-only in Phase 1 (clicking does not mutate source). Cursor: default, not pointer — don't imply interactivity. |
| 4.10 | Math delimiters inside code spans/fences (`` `$x$` ``) | Must NOT be KaTeX-rendered — delimiter scan runs on the parsed tree, skipping code nodes. |

## 5. Prompt Library — `{{Variable}}` Engine

Variable grammar: `\{\{\s*([^{}]+?)\s*\}\}` — single scan, no recursion.

| # | Case | Required behavior |
|---|---|---|
| 5.1 | Duplicate variable (`{{Topic}}` twice) | ONE input field; typing fills all occurrences simultaneously. |
| 5.2 | Empty braces `{{}}` / whitespace-only `{{ }}` | Not a variable — left as literal text. |
| 5.3 | Names with spaces & specials (`{{Programming Language}}`, `{{X (v2)}}`) | Valid. Name is matched literally (regex-escaped when substituting), label shown verbatim. |
| 5.4 | Nested/adjacent braces `{{{{A}}}}`, `{{A}}{{B}}` | Non-greedy inner match: `{{{{A}}}}` yields variable `{{A}}`'s outer braces literal + inner var (document exact behavior in Guide); `{{A}}{{B}}` = two variables. No infinite loops. |
| 5.5 | Unclosed `{{Topic` | Literal text, no dangling input. |
| 5.6 | Variable inside a code fence in the prompt body | Still a variable — prompts are plain text, not markdown-rendered. (Explicitly documented.) |
| 5.7 | Fill-in field left empty at copy time | Copy proceeds with the `{{Var}}` placeholder intact; unfilled chips highlighted amber as a nudge — never block copying. |
| 5.8 | Real-time buffer | Every keystroke recomputes the substituted string; "Copy" copies current state. Substituted preview visible on the card. |
| 5.9 | Clipboard API unavailable (non-secure ctx) or permission denied | Fallback: select-the-text + `execCommand('copy')`; if that fails, **(modal)** with the final text in a `<textarea>` for manual copy. Always a path to the text. |
| 5.10 | Copy success/failure feedback | Button morphs to "✓ Copied" 1.5 s / **(toast)** on failure. |
| 5.11 | Prompt body with 20+ variables | Inputs render in source order in a scrollable region on the card; card height capped. |
| 5.12 | "Fill In" toggled off mid-typing | Entered values kept in memory until tab switch (cheap undo); visual state resets. |

## 6. Input Hygiene & Data

| # | Case | Required behavior |
|---|---|---|
| 6.1 | Tags: `"a,, b , a ,"` | Normalize: split, trim, drop empties, case-insensitive dedupe → `["a","b"]`. Same normalization server-side. |
| 6.2 | Tag containing a comma | Impossible by construction (comma is the delimiter) — Guide documents it; input strips them. |
| 6.3 | Labels blank | Map to `Uncategorized` (client default + DB `DEFAULT`). Sub-label without label → also `Uncategorized/`+sublabel is forbidden; sublabel select disabled until label chosen. |
| 6.4 | URL list: `"https://a.com, not a url, ftp://x"` | Parse per-item; valid `http(s)` items become links; invalid items kept as plain text with a subtle ⚠ marker — never silently dropped (they may be paths/notes). |
| 6.5 | Search: `" OR 1=1 --`, `title:x`, lone `"` | Safe (SECURITY.md § 3 quoting); returns literal-match results or empty; never 500. |
| 6.6 | Search with 0 results | Empty state with the query echoed (safely) + "Clear search" action. |
| 6.7 | Unicode: emoji in titles/tags, CJK, RTL text | Stored and searched correctly (FTS `unicode61`); no mojibake; RTL renders with `dir="auto"` on title/body containers. |
| 6.8 | SQLITE_BUSY under concurrent write (two devices) | `busy_timeout=5000` absorbs it; if still busy → 503 with retry-after; client toast + auto-retry once. |
| 6.9 | Entry deleted on device A while open on device B | B's next save → 404 → **(modal)** "This entry was deleted elsewhere" with \[Save as new entry] \[Discard]. |

## 7. Markdown Import

| # | Case | Required behavior |
|---|---|---|
| 7.1 | Happy path `.md` with `# H1` first | Title ← H1 (stripped from body); body ← rest; success **(toast)** + entry opens. |
| 7.2 | No H1 anywhere | Title ← filename sans extension (sanitized, ≤300 chars). |
| 7.3 | File > 2 MB | 413 → **(modal)** with the limit stated. |
| 7.4 | Wrong type (`.txt`, `.docx`, binary renamed `.md`) | Extension check first; then NUL-byte/content sniff → 400 "Not a markdown file". |
| 7.5 | BOM, CRLF, mixed encodings | Strip BOM; normalize CRLF→LF; decode as UTF-8 with replacement chars (never crash on invalid bytes). |
| 7.6 | Frontmatter (`--- yaml ---`) | Phase 1: kept verbatim in body (no parsing). Documented in Guide. |
| 7.7 | Import while editor is dirty | Same guard as 1.2 before replacing the workspace. |
| 7.8 | Duplicate import (same content twice) | Allowed — creates a second entry (no dedup magic); user deletes if unwanted. |

## 8. Environment & Platform

| # | Case | Required behavior |
|---|---|---|
| 8.1 | `backdrop-filter` unsupported (older browser) | `@supports` fallback: solid translucent panels — legible, just not glassy. |
| 8.2 | Fullscreen API rejected (iOS Safari on iPhone) | Green light hides or no-ops with **(toast)** "Fullscreen not supported here". |
| 8.3 | Viewport < 400 px (phone over tailnet) | Editor/preview toggle mode (UX-SPEC § 3); ribbon horizontally scrollable; traffic lights remain tappable ≥ 44 px targets. |
| 8.4 | `prefers-reduced-motion` | All transitions (focus mode collapse, card flip, dock) drop to instant state changes. |
| 8.5 | System clock skew between devices | Conflict copy (3.2/3.3) shows both timestamps but decisions compare **server** `updated_at` values only — client clocks are never compared against server clocks. |
| 8.6 | Two browser tabs open on the same device | They behave as two devices (3.x rows apply). Draft key collision: last dirty tab wins the draft slot — acceptable, documented. |

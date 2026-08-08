# Bento OS — UX Specification (The Bento Metaphor)

> Companion documents: [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) · [SECURITY.md](SECURITY.md) · [EDGE-CASES.md](EDGE-CASES.md)
>
> **Status: describes the shipped UI**, including features added after the
> original five build phases (Reading/Editor mode, dynamic metadata Fields,
> editable Modified time, and four extra ribbon buttons) — not just the
> Phase-1 plan. Where this doc differs from PROJECT-BRIEF.md's original
> wording (e.g. the Prompt Library's "Fill In and Copy" toggle), **this doc
> is authoritative** — it reflects a deliberate later revision, recorded in
> IMPLEMENTATION-PLAN.md § 8.

---

## 1. Design Tokens & Aesthetic Direction

- **Mode**: dark-first. Dark is the default and the design target; light mode
  is a supported variant via Tailwind `dark:` strategy (class on `<html>`,
  toggle persisted in localStorage, initial value from `prefers-color-scheme`).
- **Glassmorphism discipline**: `backdrop-filter: blur()` is reserved for
  *chrome* — window frame, dock, modals, sticky ribbon. Content surfaces
  (editor, preview, cards) sit on near-opaque panels: text over live blur
  fails contrast and tires the eye. Every glass surface carries a
  semi-opaque tint layer so WCAG contrast is computed against a known worst
  case, not whatever scrolls underneath.
- **Tokens** (Tailwind theme extension, not ad-hoc utilities): a small fixed
  scale — background, panel, glass-tint, ink, ink-muted, accent, plus the
  three semantic alert hues (success/info/warning) shared by the ribbon's
  alert blocks and system toasts. Radius scale: `lg` for cards, `2xl` for the
  window frame. One shadow recipe for elevation, used everywhere.
- **Typography**: UI in a system-stack sans (SF-adjacent); editor and prompt
  bodies in a real monospace stack. Type scale limited to 4 sizes + weight
  shifts — bento boxes read calm because they don't shout.
- **Motion**: one standard easing and two durations (fast ~150 ms for
  hover/press, medium ~300 ms for layout shifts like Focus Mode). Everything
  honors `prefers-reduced-motion` (EDGE-CASES § 8.4).

## 2. The Window Frame & Traffic Lights

A fixed macOS-style window frame contains the whole app: title bar with
traffic lights (left), app title (center), tab strip (LogBook · Prompt
Library) beneath.

| Light | Action | Spec |
|---|---|---|
| 🔴 Red | **Minimize to dock** | Active tool collapses (scale+fade, medium duration) into a pill in the **status dock** — a slim bar along the bottom of the frame. Dock pill shows tool icon + name + dirty dot if unsaved. Click pill → restore with reverse animation. Dock hidden when empty. Minimizing never discards state (DOM hidden, not unmounted — consistent with EDGE-CASES § 1.4). |
| 🟡 Yellow | **Focus Mode toggle** | Sidebars + metadata panels collapse (width→0 with medium transition; content `visibility:hidden` after transition for a11y tree cleanliness). Editor/preview expands to full frame width. Yellow light renders a subtle "pressed" state while active. Second press restores exact prior layout. Keyboard: `⌘.` / `Ctrl+.`. |
| 🟢 Green | **Browser fullscreen** | `document.documentElement.requestFullscreen()` toggle. Unsupported (iOS Safari) → EDGE-CASES § 8.2. On `fullscreenchange` from any source (Esc), light state resyncs. |

Traffic lights: real `<button>`s, ≥ 44 px touch targets on coarse pointers
(the visual dot can be smaller than the hit area), `aria-label`s
("Minimize to dock", "Toggle focus mode", "Toggle fullscreen"), icons appear
in the dots on hover (macOS convention).

## 3. Docs LogBook Layout

### Reading vs Editor mode (primary content-area concept)

The main content area of the LogBook has two working modes, controlled by
one icon toggle button in the entry header (`#lb-mode-toggle`), plus a
third at-rest state when nothing is open — full behavior spec in
EDGE-CASES.md § 9:

- **Reading mode** (the default when you open an existing note): only the
  rendered preview is shown, centered at a ~46rem comfortable reading
  measure. The Summary section, the Body section header, the formatting
  ribbon, and the raw markdown editor are all hidden — not just visually
  collapsed, removed from layout and tab order.
- **Editor mode** (the default for a brand-new note): the full authoring
  view described below — Summary, Body header, ribbon, and the split
  editor/preview.
- **Closed** (after the × in the entry header): no entry is open, so the
  workspace shows the reactive face card — the same one that greets the
  Prompt Library and Code Snippets tabs — centered, with a "New Entry"
  button under it. Every per-entry control goes away, including the
  metadata panel. Closing a note should look like a closed note, not like
  a blank one you're being asked to fill in.

The toggle icon itself swaps between an open-book glyph (currently Reading
— click to switch to Editor) and a pencil glyph (currently Editor — click
to switch to Reading). Its `title` attribute carries the same message as a
plain hover tooltip — no separate tooltip widget is used.

### Wide viewports (≥ 1024 px), Editor mode
```
┌───────────────────────── window frame ─────────────────────────┐
│ ●●●  Bento OS            [ LogBook | Prompt Library ]           │
├──────────┬───────────────────────────────────────────┬──────────┤
│ Sidebar  │  Summary/Problem Statement (collapsible)   │ Metadata │
│ search   │  Body (Content: knowledge/solutions/…)     │  panel   │
│ entries  │  ── sticky tool ribbon ──                  │          │
│ guide 💡 │  Editor (md)      │  Preview (rendered)     │          │
├──────────┴───────────────────┴─────────────────────────┴──────────┤
│ status dock (when non-empty)                                       │
└──────────────────────────────────────────────────────────────────┘
```
- Editor/Preview split is 50/50 with a draggable divider (double-click
  resets). Preview scroll loosely follows editor cursor (`data-line` markers).
- In **Reading mode**, this whole authoring column collapses to just the
  centered preview — see above.

### Narrow viewports (< 1024 px)
- Within Editor mode: a **high-contrast segmented toggle** (Write / Preview)
  pinned in the ribbon — large, thumb-reachable, state obvious at a glance.
  This toggle is irrelevant in Reading mode (there's no split to toggle —
  EDGE-CASES § 9.8).
- Sidebar becomes an overlay drawer (hamburger in title bar) with a scrim;
  swipe/Esc/scrim-tap closes. Focus trapped while open.
- Metadata panel becomes the same kind of overlay, mirrored to the right
  edge (gear in the entry header), with its own close button in the sheet
  header — the scrim is not a discoverable exit on a phone, and the toggle
  that opened it sits behind the overlay. It is **never** shown in flow at
  this width: at `w-72` it would leave a 390 px viewport about 100 px of
  workspace and wrap the entry header into a column of buttons
  (EDGE-CASES § 8.7). Between 1024 px and 1280 px there is room, and it
  stays an in-flow column there.

### Sidebar
- Live search box filters as-you-type (input debounced 200 ms → FTS query).
  Scope: titles, tags, summary, body, **and dynamic field names/values**
  (§ "Metadata panel" below). Zero-hit state per EDGE-CASES § 6.6.
- **Group by** toggle (3-way segmented control: Flat / Label / Year, same
  pattern as the narrow-viewport Write/Preview toggle) sits between the
  search box and the entry list:
  - **Flat** — a single ordered list, most recently modified first (the
    only mode that existed before this feature).
  - **Label** — collapsible `<details>` sections per Label, alphabetical
    with `Uncategorized` forced last; entries carrying a Sub-label render
    under a smaller nested sub-heading inside their Label's section rather
    than as their own top-level group (avoids colliding same-named
    sub-labels that belong to different Labels).
  - **Year** — collapsible sections by year (derived from `updated_at`),
    newest year first.
  - Grouping and the tag filter below both apply client-side, on top of
    whatever the entry list currently holds — including an active search —
    so they compose with search rather than replacing it.
- **Tag filter pills** directly below the Group-by toggle, reusing the
  Prompt Library's pill component and interaction (multi-select OR, an
  "All" pill that's always present and shows pressed when no filter is
  active). Capped to the **top 6 tags by how many entries use them** —
  unlike the Prompt Library's uncapped version, since an unbounded tag
  vocabulary would keep pushing the entry list further down a narrow,
  vertical-space-constrained sidebar. A less-common tag not shown as a
  pill is still reachable by typing it into the search box, which already
  indexes tags. The row itself is hidden entirely (no reserved space) when
  no entry has any tag; if it's non-empty it wraps but is height-capped
  with its own internal scroll as a safety net. An already-active filter
  tag is never hidden by the cap, even if other tags overtake its
  frequency ranking.
- Entry rows: title (1-line ellipsis), label›sublabel breadcrumb chip,
  relative date, dirty dot when the open entry is that row. Active row uses
  the accent tint.
- **Sidebar Hide/Show**: a separate icon toggle in the entry header
  (wide viewports only — narrow viewports already have the overlay drawer
  for this) reclaims the sidebar's width for the editor/preview/metadata
  area. Deliberately independent of Focus Mode, which hides the sidebar
  *and* the metadata panel together for distraction-free writing sessions
  — this is a lighter, faster, more-often-reached-for toggle (e.g. useful
  while just reading a note). The two compose: the sidebar stays hidden if
  either is active, and is visible only when both are off. Persists across
  reloads.
- Footer: "💡 Guide" link → Guide modal (markdown usage, syntax cheatsheet
  content in prose, the documented quirks from EDGE-CASES §§ 5.4, 6.2, 7.6).

### Summary / Problem Statement (Editor mode only)

A collapsible section (native `<details>`, chevron rotates on open/close)
positioned **above** the body — not inside the metadata panel. Open by
default; the textarea shows at least 3 rows and is vertically resizable.
Collapsing it is purely a screen-space convenience — the value is never
cleared by collapsing.

### Body section header (Editor mode only)

A small label directly above the sticky ribbon: **"Body"** with a muted
parenthetical hint — *"(Content: knowledges, solutions, troubleshooting,
workarounds)"* — telling the user what kind of writing belongs in the main
editor, distinct from the Summary above it.

### Sticky Tool Ribbon (Editor mode only)
- Anchored above the editor, horizontally scrollable on overflow (no wrap —
  vertical rhythm stays stable).
- Groups, in order: headings H1–H3 · bold/italic/strikethrough ·
  **superscript/subscript** · inline-code · link · **bulleted list /
  numbered list** · checkbox item · 3×4 table generator · alert blocks
  (`Success`/`Info`/`Warning` pre-styled component injectors) · 💡 bulb.
- All buttons are *cursor-aware injections*: wrap selection if any, else
  insert boilerplate at caret and place the caret inside the placeholder.
  List buttons instead *prefix every line* of the current selection (or
  just the current line if nothing is selected) — `- ` for bulleted,
  `1. `/`2. `/… (renumbered per line) for numbered.
- **Superscript/subscript use literal `<sup>`/`<sub>` HTML tags**, not the
  `^text^`/`~text~` markdown-it extension syntax — deliberately, because
  `^` is how KaTeX writes exponents inside `$…$` math and would otherwise
  collide (SECURITY.md § 2, EDGE-CASES § 4.11).
- Every button has a tooltip with its keyboard shortcut where one exists
  (`⌘B`, `⌘I`, `⌘K`, `⌘S` = save).
- **💡 Bulb dropdown (Syntax Reference)**: cheat-sheet entries for inline
  LaTeX (`$…$`), block LaTeX (`$$…$$`), and a Mermaid flowchart starter
  fence. Each row shows a mini rendered example; clicking injects the exact
  boilerplate at the cursor and closes the menu. Menu is keyboard-navigable
  (arrow keys + Enter), and renders at `position: fixed` anchored to the
  button (not inside the ribbon's own scroll container, which would clip
  it, and not inside any `backdrop-filter` ancestor, which would hijack
  `position: fixed`'s containing block).

### Metadata panel (visible in both Reading and Editor mode)

Collapsible right-edge panel (auto-collapsed by Focus Mode), top to bottom:

1. **Label** / **Sub-label** — text inputs; sub-label is disabled until a
   label is set; blank label displays and stores as `Uncategorized`.
2. **Tags** — comma-separated input, rendered as chips below it.
3. **Fields** — user-defined name/value metadata, TiddlyWiki-style. One row
   per field: a right-aligned name label, an editable value `<input>`, and
   a 🗑 delete button. Below the rows, an "add a new field" row: a name
   input (with a `<datalist>` suggesting names already used on *other*
   entries), a value input, and an **add** button — Enter in either input
   also submits. Adding a field with a name already present on this entry
   (case-insensitive) is rejected with an inline error, not silently
   merged or duplicated. An empty-state hint ("No fields yet — add one
   below…") shows when the entry has none. **There is no fixed OS-Platform
   dropdown or isValid checkbox** — those were replaced by this general
   mechanism (IMPLEMENTATION-PLAN.md § 8.1).
4. **Created** — read-only, labeled "(read-only)", human-formatted with the
   raw UNIX ms in a tooltip. Never becomes an input.
5. **Modified** — a real `<input type="datetime-local">`, editable. Left
   alone, it auto-updates to "now" on every save, same as before this was
   editable; hand-editing it and saving stores that exact value instead.
   `color-scheme` is set per theme (`:root{color-scheme:light}` /
   `.dark{color-scheme:dark}`) so the native browser date/time picker
   itself matches dark mode rather than always rendering light-chrome.
6. **URL list** — the `<details>` collapses the comma-separated *input* only;
   the parsed link chips sit below it and stay visible either way, with a
   count badge on the summary row (§ EDGE-CASES 6.4).
7. **Delete entry** — destructive action, visually separated (danger color,
   own row) from everything above it.

## 4. Prompt Library Layout

- **Top**: prominent search bar (same debounce/FTS behavior), then a tight
  wrapping row of pill tag-filters. Pills toggle (multi-select, OR
  semantics); active pills fill with accent; an "All" pill resets. Active
  filters + search compose (AND between search and tag set).
- **Groups**: small all-caps category labels (`ink-muted`, letter-spaced)
  with generous vertical padding between groups. Categories ordered
  alphabetically; empty categories hidden.
- **Prompt cards**: vertically stacked rounded rectangles — bold title,
  category + tag chips, a monospace prompt body in a scrollable well
  (max-height clamp), actions row: **Copy** · **Why this works** (flip,
  only shown if the prompt has one) · Edit · Delete.
- **Variables are directly editable in place — there is no "Fill In and
  Copy" toggle button.** Each `{{Variable}}` occurrence inside the
  monospace well renders as its own `contenteditable` span
  (`role="textbox"`, `aria-label="Value for <Name>"`, `aria-multiline=
  "false"`), always live, no mode to switch into first:
  - Unedited, a slot shows the literal placeholder text (`{{Topic}}`) with
    an amber tint (`.var-empty`) — visually inviting a click without
    demanding one.
  - The **first** focus into a slot selects its entire content, so the
    very next keystroke replaces the whole placeholder — feels like a
    normal form field despite living inline in running text.
  - Once it holds real text, the slot switches to an accent tint
    (`.var-filled`), bold.
  - Duplicate occurrences of the same variable name mirror each other's
    text live as you type (except the one you're actively typing in).
  - Clearing a slot to empty and clicking away reverts it to the literal
    placeholder — it is never left blank.
  - Enter is blocked inside a slot (no newlines in a value); paste is
    forced to plain text.
  - **Copy** always reflects exactly what's currently on screen —
    unedited variables copy as their placeholder text, edited ones copy
    the typed value.
- **"Why this works"**: card flip (3D rotate, medium duration; instant swap
  under reduced-motion) to a prose back face; flip control mirrored on the
  back. Back face height matches front (content scrolls) so the stack never
  jumps. Only rendered on cards that actually have this text — no empty
  flip affordance on cards without it.
- **Empty states**: no prompts at all → friendly illustration + "New Prompt"
  CTA; filter/search with zero hits → EDGE-CASES § 6.6 pattern.

## 5. Accessibility Requirements (acceptance-level, not aspirational)

- Contrast: all text ≥ 4.5:1 (3:1 for large text) measured against each glass
  surface's *tint worst case* (§ 1).
- Full keyboard operability: tab strip = `role="tablist"` with arrow-key
  navigation; dock pills, ribbon, pills, cards, and prompt variable slots
  all reachable and operable via keyboard; visible `:focus-visible` rings
  (accent, 2 px offset) everywhere — never `outline: none` without
  replacement. Contenteditable variable slots additionally get a plain
  `:focus` ring (not `:focus-visible`-gated), since a user needs to see
  exactly where their edit landed regardless of whether they got there by
  mouse or keyboard.
- Modals: `role="dialog"` `aria-modal`, focus trapped, Esc closes (except
  destructive-choice modals where Esc = Cancel), focus returns to the
  invoking element on close.
- Toasts: `role="status"` (polite) for success/info, `role="alert"` for
  errors; never the only channel for blocking information (modals carry
  decisions, toasts carry notices).
- Editor is a real `<textarea>` (native a11y, undo, IME, mobile keyboards)
  — not `contenteditable`. `dir="auto"` for RTL (EDGE-CASES § 6.7). Prompt
  Library's variable slots are the one deliberate exception — they're
  `contenteditable` `<span>`s because they live inline inside otherwise-
  static rendered text, given explicit `role="textbox"` +
  `aria-label`/`aria-multiline` to compensate.
- Announce state changes: save success, focus-mode toggle, copy result,
  Reading/Editor mode switch, via a visually-hidden live region.

## 6. System Feedback Patterns (single vocabulary, used by both tabs)

| Pattern | Used for | Rules |
|---|---|---|
| **Modal** | Decisions & blocking errors (unsaved close, conflicts, restore prompt, delete confirm, import errors, duplicate field name) | Max 3 actions, destructive action styled distinctly and never default-focused; specific verbs ("Discard draft", not "OK") |
| **Banner** | Non-blocking persistent state (newer-version-exists § 3.2, host unreachable) | Slim strip above the editor; dismissible; one at a time |
| **Toast** | Transient outcomes (saved ✓, copied ✓, autosave paused, network retry) | Bottom-right, auto-dismiss 3.5 s, hover pauses timer, max 2 stacked |
| **Inline chip / error text** | Localized render failures (LaTeX/Mermaid error blocks § 4.1–4.2), invalid URL markers, duplicate-field-name message | Never modal — errors stay next to their cause |

Save flow feedback: `⌘S`/button → button enters spinner state (only if
> 150 ms) → ✓ morph 1.2 s → sidebar row updates. Dirty state: dot on tab
label + "Edited" hint near Save — always visible, never only in the tab
title. Editing a dynamic field or the Modified time counts as "dirty" the
same as editing the body.

## 6a. Installed App (PWA)

- **Install** is offered from the account menu ("Install Bento OS…"), shown
  only once the browser reports the app is installable — Bento OS never
  interrupts with an install banner of its own.
- Installed, it opens in a standalone window with no browser chrome; the
  title bar's traffic lights and dock keep working as the app's own window
  metaphor. Manifest shortcuts jump straight to a tool (`?tool=prompts`).
- **Offline** the app shell loads normally and the title-bar chip reads
  *offline* immediately. What offline gives you is the application, not the
  library: entries, prompts and snippets come from the Express API and are
  not cached (SECURITY.md § 4a), so lists come up empty until the host is
  reachable again — an honest empty state, never a fake one.
- Updates install in the background and apply on the next launch, announced
  by a toast. Nothing is force-reloaded under an open editor.

## 7. First-Run & Empty States

- Fresh database: LogBook opens with a pre-seeded **welcome entry** that is
  itself a working demo — sample headings, a checkbox list, one KaTeX
  formula, one Mermaid diagram, one of each alert block, **and two example
  dynamic Fields** (`os_platform: macOS`, `is_valid: true`) demonstrating
  the Fields editor with real data on first boot. Doubles as a render
  self-test and teaches the ribbon by example.
- Prompt Library fresh state: one seeded example prompt containing two
  `{{Variables}}` and a filled "Why this works" back, demonstrating the
  card's full behavior (including the inline variable-editing engine) out
  of the box.
- Guide modal is linked from both seeds.

## 8. Acceptance Checklist

- [x] All three traffic lights behave per § 2 on desktop + phone-width, incl. reduced-motion variants
- [x] Focus mode round-trips to the exact prior layout; keyboard shortcut works
- [x] Split view divider drag + reset; narrow-viewport toggle switch reachable one-handed (Editor mode only)
- [x] Every ribbon button injects correctly with selection and with bare caret; shortcuts fire; list buttons prefix multi-line selections correctly
- [x] Superscript/subscript render as real elements when bare, as literal text when attribute-bearing; math with `^` is never affected
- [x] Bulb menu keyboard-navigable; injected LaTeX/Mermaid boilerplate renders immediately in preview
- [x] Card flip, pill filters pass; every prompt variable-engine row in EDGE-CASES § 5 passes (inline editing, no toggle)
- [x] Reading mode is the default on opening an existing note; Editor mode is the default for a new note; toggle icon + hover label work in both directions (EDGE-CASES § 9)
- [x] Closing an entry lands in Closed mode with the face card centered, per-entry chrome and metadata panel gone, ⌘S inert; New Entry and sidebar rows both exit it (EDGE-CASES § 9.9–9.10)
- [x] Dynamic Fields: add/edit/delete/duplicate-name-rejection/search-by-value all pass (EDGE-CASES § 10)
- [x] Modified time: manual edit persists verbatim, auto-bump still works on the next plain save, Created never becomes editable, conflict detection unaffected (EDGE-CASES § 11)
- [ ] axe scan: zero critical/serious findings on both tabs, both themes *(not yet run as an automated CI step — manual spot checks only so far)*
- [x] All feedback patterns (§ 6) demonstrated: force a 409, an autosave restore, a render error, a copy fallback
- [x] Welcome seeds render all four content technologies (md, KaTeX, Mermaid, alerts) plus two example Fields on first boot

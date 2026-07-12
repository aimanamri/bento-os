# Bento OS — UX Specification (The Bento Metaphor)

> Companion documents: [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) · [SECURITY.md](SECURITY.md) · [EDGE-CASES.md](EDGE-CASES.md)
>
> Build-time note: Phase E (and any UI construction) invokes the
> `ui-ux-pro-max` skill — its domain (bento grid, glassmorphism, dark mode,
> responsive) is exactly this design language. This spec defines *what* the
> experience is; the skill governs *how* it's crafted.

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

### Wide viewports (≥ 1024 px)
```
┌───────────────────────── window frame ─────────────────────────┐
│ ●●●  Bento OS            [ LogBook | Prompt Library ]           │
├──────────┬─────────────────────────────┬───────────────────────┤
│ Sidebar  │  Editor (md source)         │  Preview (rendered)   │
│ search   │  ── sticky tool ribbon ──   │                       │
│ entries  │                             │                       │
│ guide 💡 │                             │                       │
├──────────┴─────────────────────────────┴───────────────────────┤
│ status dock (when non-empty)                                    │
└─────────────────────────────────────────────────────────────────┘
```
- Split is 50/50 editor/preview with a draggable divider (double-click
  resets). Preview scroll loosely follows editor cursor (`data-line` markers).

### Narrow viewports (< 1024 px)
- Single pane with a **high-contrast segmented toggle** (Write ✏️ / Preview 👁)
  pinned in the ribbon — large, thumb-reachable, state obvious at a glance.
- Sidebar becomes an overlay drawer (hamburger in title bar) with a scrim;
  swipe/Esc/scrim-tap closes. Focus trapped while open.

### Sidebar
- Live search box filters as-you-type (input debounced 200 ms → FTS query).
  Scope: titles, tags, metadata. Zero-hit state per EDGE-CASES § 6.6.
- Entry rows: title (1-line ellipsis), label›sublabel breadcrumb chip,
  relative date, dirty dot when the open entry is that row. Active row uses
  the accent tint.
- Label/sub-label groups collapsible; `Uncategorized` always sorts last.
- Footer: "💡 Guide" link → Guide modal (markdown usage, syntax cheatsheet
  content in prose, the documented quirks from EDGE-CASES §§ 5.4, 6.2, 7.6).

### Sticky Tool Ribbon
- Anchored above the editor, horizontally scrollable on overflow (no wrap —
  vertical rhythm stays stable).
- Groups, in order: headings H1–H3 · bold/italic/strike/inline-code · code
  block · checkbox · link · 3×4 table generator · alert blocks
  (`Success`/`Info`/`Warning` pre-styled component injectors) · 💡 bulb.
- All buttons are *cursor-aware injections*: wrap selection if any, else
  insert boilerplate at caret and place the caret inside the placeholder.
  Every button has a tooltip with its keyboard shortcut (`⌘B`, `⌘I`, `⌘K`,
  `⌘S` = save).
- **💡 Bulb dropdown (Syntax Reference)**: cheat-sheet entries for inline
  LaTeX (`$…$`), block LaTeX (`$$…$$`), and a Mermaid flowchart starter
  fence. Each row shows a mini rendered example; clicking injects the exact
  boilerplate at the cursor and closes the menu. Menu is keyboard-navigable
  (arrow keys + Enter).

### Metadata panel
- Collapsible right-edge panel (auto-collapsed by Focus Mode): summary
  (auto-resizing textarea), label/sub-label selects, tags input (renders
  chips on comma/Enter, normalization per EDGE-CASES § 6.1), platform
  dropdown, `isValid` switch, immutable created timestamp (read-only,
  human-formatted, raw UNIX in tooltip), URL list (collapsible container,
  per-item validity per EDGE-CASES § 6.4).

## 4. Prompt Library Layout

- **Top**: prominent search bar (same debounce/FTS behavior), then a tight
  wrapping row of pill tag-filters. Pills toggle (multi-select, OR
  semantics); active pills fill with accent; an "All" pill resets. Active
  filters + search compose (AND between search and tag set).
- **Groups**: small all-caps category labels (`ink-muted`, letter-spaced)
  with generous vertical padding between groups. Categories ordered
  alphabetically; empty categories hidden.
- **Prompt cards**: vertically stacked rounded rectangles — bold title,
  category + tag chips, monospace prompt body in a scrollable well (max-height
  clamp), actions row: **Copy** · **Fill In and Copy** (toggle) · **Why this
  works** (flip) · Edit · Delete.
- **Fill In and Copy**: toggling ON scans `{{Variables}}` (grammar and all
  edge behavior per EDGE-CASES § 5) and renders labeled inline inputs on the
  card in source order; the monospace well live-highlights substituted
  segments as you type; Copy always reflects the current buffer. Unfilled
  variables tint amber, copying never blocked (§ 5.7).
- **"Why this works"**: card flip (3D rotate, medium duration; instant swap
  under reduced-motion) to a prose back face; flip control mirrored on the
  back. Back face height matches front (content scrolls) so the stack never
  jumps.
- **Empty states**: no prompts at all → friendly illustration + "New Prompt"
  CTA; filter/search with zero hits → EDGE-CASES § 6.6 pattern.

## 5. Accessibility Requirements (acceptance-level, not aspirational)

- Contrast: all text ≥ 4.5:1 (3:1 for large text) measured against each glass
  surface's *tint worst case* (§ 1). Automated check with axe in Phase E.
- Full keyboard operability: tab strip = `role="tablist"` with arrow-key
  navigation; dock pills, ribbon, pills, cards all reachable; visible
  `:focus-visible` rings (accent, 2 px offset) everywhere — never
  `outline: none` without replacement.
- Modals: `role="dialog"` `aria-modal`, focus trapped, Esc closes (except
  destructive-choice modals where Esc = Cancel), focus returns to the
  invoking element on close.
- Toasts: `role="status"` (polite) for success/info, `role="alert"` for
  errors; never the only channel for blocking information (modals carry
  decisions, toasts carry notices).
- Editor is a real `<textarea>` in Phase 1 (native a11y, undo, IME, mobile
  keyboards) — not `contenteditable`. `dir="auto"` for RTL (EDGE-CASES § 6.7).
- Announce state changes: save success, focus-mode toggle, copy result via a
  visually-hidden live region.

## 6. System Feedback Patterns (single vocabulary, used by both tabs)

| Pattern | Used for | Rules |
|---|---|---|
| **Modal** | Decisions & blocking errors (unsaved close, conflicts, restore prompt, delete confirm, import errors) | Max 3 actions, destructive action styled distinctly and never default-focused; specific verbs ("Discard draft", not "OK") |
| **Banner** | Non-blocking persistent state (newer-version-exists § 3.2, host unreachable) | Slim strip above the editor; dismissible; one at a time |
| **Toast** | Transient outcomes (saved ✓, copied ✓, autosave paused, network retry) | Bottom-right, auto-dismiss 3.5 s, hover pauses timer, max 2 stacked |
| **Inline chip** | Localized render failures (LaTeX/Mermaid error blocks § 4.1–4.2), invalid URL markers | Never modal — errors stay next to their cause |

Save flow feedback: `⌘S`/button → button enters spinner state (only if
> 150 ms) → ✓ morph 1.2 s → sidebar row updates via `entry:saved` bus event.
Dirty state: dot on tab label + "Edited" hint near Save — always visible,
never only in the tab title.

## 7. First-Run & Empty States

- Fresh database: LogBook opens with a pre-seeded **welcome entry** that is
  itself a working demo — sample headings, a checkbox list, one KaTeX
  formula, one Mermaid diagram, one of each alert block. Doubles as a render
  self-test and teaches the ribbon by example.
- Prompt Library fresh state: one seeded example prompt containing two
  `{{Variables}}` and a filled "Why this works" back, demonstrating the
  card's full behavior.
- Guide modal is linked from both seeds.

## 8. Phase-E Acceptance Checklist

- [ ] All three traffic lights behave per § 2 on desktop + phone-width, incl. reduced-motion variants
- [ ] Focus mode round-trips to the exact prior layout; keyboard shortcut works
- [ ] Split view divider drag + reset; narrow-viewport toggle switch reachable one-handed
- [ ] Every ribbon button injects correctly with selection and with bare caret; shortcuts fire
- [ ] Bulb menu keyboard-navigable; injected LaTeX/Mermaid boilerplate renders immediately in preview
- [ ] Card flip, pill filters, fill-in engine pass every EDGE-CASES § 5 row
- [ ] axe scan: zero critical/serious findings on both tabs, both themes
- [ ] All feedback patterns (§ 6) demonstrated: force a 409, an autosave restore, a render error, a copy fallback
- [ ] Welcome seeds render all four content technologies (md, KaTeX, Mermaid, alerts) on first boot

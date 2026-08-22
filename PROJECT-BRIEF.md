# Project Brief: Bento OS (Local-First Productivity Suite)

> This brief describes the app as it is currently built, including every
> refinement made after the initial Phase 1 delivery. For full technical
> detail behind any point below, see
> [docs/IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md),
> [docs/IMPLEMENTATION-SUPABASE.md](docs/IMPLEMENTATION-SUPABASE.md) /
> [docs/IMPLEMENTATION-LOCAL.md](docs/IMPLEMENTATION-LOCAL.md),
> [docs/SECURITY.md](docs/SECURITY.md),
> [docs/EDGE-CASES.md](docs/EDGE-CASES.md), and
> [docs/UX-SPEC.md](docs/UX-SPEC.md) — those are the source of truth where
> this brief and they might ever disagree.

---

## 1. Project Overview

A local-first, lightweight web application designed to act as a personal knowledge base, prompt library, and code-snippet vault. **Bento OS** features a modular, macOS-inspired UI window metaphor with rich text layouts, acrylic blur effects (`backdrop-filter`), and a light/dark aesthetic that defaults to the device's own preference.

Bento OS is now multi-user, with authentication, role-based access, and per-user data isolation — sign-in is a lock screen carrying the app's own identity, not a bare login card. Data ownership and independence from any single cloud provider remain a first-class goal: the app runs on either a managed Supabase (Postgres + Auth) backend, a fully self-hosted Docker stack that speaks the same API with no cloud account, or a local single-file SQLite + Express backend for offline testing over Tailscale. Phase 1 delivered two tools (Tabs); a third — Code Snippets — joined afterward. All three are complete and running; this brief describes them as built. The display language switches between English, Japanese, and Bahasa Melayu without a reload.

---

## 2. Integrated Tech Stack & Architecture

### Frontend Architecture

* **Core Engine:** Vanilla JavaScript (ES6+) for lean, programmatic DOM manipulation, dynamic component building, and data flow without framework overhead.
* **Styling & UI Framework:** **Tailwind CSS**. A utility-first compiler workflow deployed to enforce a strict design token system. Dark mode utilities (`dark:` modifiers) and backdrop utilities handle the custom macOS glassmorphism effects out-of-the-box; the theme toggle defaults to `prefers-color-scheme` rather than a hardcoded mode.
* **Interactivity:** Native custom event architectures manage tab swapping, list updates, and ribbon actions cleanly without external state management libraries. In practice this stayed intentionally small — a handful of app-wide events (theme changes, display-language changes, entry dirty/saved state, tab switching) go through a shared event bus, while everything else is a direct function call within its own feature area.
* **Internationalization:** A catalogue-based i18n system covers the full app — chrome, dialogs, toasts, the pre-sign-in tour, the Markdown guide — with English, Japanese, and Bahasa Melayu catalogues. Switching language re-renders in place; it never reloads the page or discards an in-progress draft. The three tool names and admin role names stay in English in every locale, for one consistent product identity.

### Backend Infrastructure

* **Default — Supabase:** PostgreSQL + Auth (GoTrue), accessed directly from the browser via `supabase-js` under Row-Level Security (`user_id = auth.uid()`). Sensitive operations (admin password resets, account deletion) run in Edge Functions. Express is reduced to a static host — it owns no data.
* **Self-hosted alternative — Docker:** the same Postgres + GoTrue + PostgREST + Edge Functions API surface, packaged as a local compose stack, for running with no cloud account at all.
* **Testing/offline variant — local SQLite:** a single-file `better-sqlite3` database in WAL mode behind an Express REST API, with the same auth/RBAC feature set enforced at the route layer instead of RLS, reachable over a Tailscale overlay network with no public port forwarding.
* All three backends expose an identical response contract, so the frontend code is backend-agnostic above one thin `api()` adapter layer.

### Core Utilities & Micro-Libraries

* `markdown-it` (High-speed Markdown parsing — settled on over `marked.js`)
* `KaTeX` (Fast, isolated LaTeX mathematical formula compiler)
* `Mermaid.js` (Dynamic runtime canvas/SVG charting and workflow diagram engine)
* `Prism` (Syntax highlighting for fenced code blocks and code snippets, by language/infostring)
* `DOMPurify` (Strict client-side XSS prevention sanitization pipeline — the single choke point every rendered Markdown string passes through, after every other transform)

---

## 3. UI/UX Design System (The Bento Metaphor)

* **Window Aesthetics:** A fixed macOS-style application window frame utilizing crisp typography, smooth drop shadows, and responsive Tailwind layouts grid containers resembling a Japanese bento box.
* **Functional Traffic Lights:**
  * 🔴 **Red:** Minimizes the active page/tool down to a clean status dock.
  * 🟡 **Yellow:** Toggles Focus Mode (instantly collapses sidebars and auxiliary metadata panels for distraction-free writing using smooth transitions).
  * 🟢 **Green:** Toggles native browser fullscreen mode.
* **Reading vs. Editor Mode:** Opening an existing note lands you in a clean **Reading** view — just the rendered content, nothing to accidentally edit. A single icon toggle in the note header (hover shows its label) switches into **Editor** mode for the full authoring layout. Starting a brand-new note skips straight to Editor mode, since there's nothing to read yet.
* **Lock screen:** Signing in is a full macOS-lock-screen-style experience — the same bento-grid wallpaper, dock, and glass-sheet chrome as the signed-in app, fronted by the app's mascot face card, which reacts live to a rejected or accepted sign-in attempt. Theme and display-language switching are both available from the lock screen, not just once inside.
* **Pre-auth tour:** Each of the three dock pills opens its own short tour — two claims and a live demo built from the app's real rendering code, not a screenshot — instead of one generic summary shared by all three.

---

## 4. Core Feature Specifications

### Tab 1: Docs LogBook (Default Homepage)

A workspace dedicated to logging deep technical notes, project post-mortems, and engineering guides.

* **Sidebar Navigation:** Tracks all saved entries, provides a live Search Box filtering across Titles, Tags, Summary, body text, and any custom metadata Fields (see below), and links to a helpful markdown usage **Guide Modal**.
* **Split Interface:** In Editor mode, provides a dual Editor/Preview view on wide viewports and a high-contrast toggle switch on narrower viewports. Reading mode shows only the rendered preview, centered at a comfortable reading width.
* **Sticky Tool Ribbon:** Anchored formatting toolbar offering quick-injection buttons for standard headings (H1-H3), bold/italic/strikethrough, **superscript and subscript**, inline code, links, **bulleted and numbered lists**, checkboxes, a 3x4 table generator, and code blocks. It also features pre-styled component blocks for GitHub-style alerts (`Note`, `Tip`, `Important`, `Warning`, `Caution`).
* **Syntax Reference (Bulb Icon):** A dropdown cheat sheet that injects exact boilerplate blocks for inline/block LaTeX mathematical formulas and Mermaid flowcharts directly into the cursor position.
* **Rendered code blocks:** every fenced code block syntax-highlights by its language and carries a one-click copy button in its corner.
* **Data Structure:**
  * *Title* (String, Required)
  * *Details/Solution* (Markdown Text, Required) — lives in an Editor-mode section explicitly labeled **Body**, describing the kind of content it's for (knowledge, solutions, troubleshooting, workarounds)
  * *Summary/Problem Statement* (Resizable text element) — a collapsible section positioned directly **above** the Body editor, open by default, minimum 3 visible lines
  * *Labels & Sub-labels* (Hierarchical structure; maps to `Uncategorized` if left blank)
  * *Tags* (Comma-separated array)
  * *Metadata:*
    * *Created* — an immutable UNIX timestamp, permanently read-only from the moment the entry is first saved
    * *Modified* — a UNIX timestamp that normally auto-updates on every save, but can also be **set by hand** to any specific date/time when you need to (e.g. backdating an imported note)
    * *Fields* — an open-ended set of your own name/value metadata (TiddlyWiki-style rows you add and remove freely), searchable from the sidebar, collapsible at every viewport width. There is no fixed OS Platform dropdown or `isValid` checkbox baked into the schema — if you want either, add them as Fields (`os_platform: macOS`, `is_valid: true`); the mechanism is general-purpose rather than hardcoded to two specific properties.
  * *URL Lists* (Collapsible container handling comma-separated web links)
* **Actions & Guards:** "Save Entry", "Import as Markdown File", "+ New Entry", "Close [x]". Triggers modal warnings if a user attempts to save a blank entry or close an unsaved, modified entry.

### Tab 2: Prompt Library

A structural repository for saving, tuning, and executing AI prompt templates.

* **Structural Layout:** Begins with a prominent top search bar, immediately followed by a tight row of pill-shaped tag filter buttons. Content organizes into distinct groups via small, all-caps category labels separated by generous vertical padding.
* **Prompt Cards:** Vertically stacked, rounded rectangular cards displaying a bold primary title, category data, and a monospace text container housing the prompt itself.
* **Dynamic Variable Substitution — edited directly in place:**
  * Prompts can be saved using regex-scannable double-brace variables (e.g., `{{Topic}}` or `{{Programming Language}}`).
  * Each variable renders as its own small editable region **directly inside the prompt text** on the card — there's no separate mode to switch into first. Click a placeholder and start typing to replace it; the very first click selects the whole placeholder so typing overwrites it cleanly, the way a normal form field would. Type the same variable name twice in one prompt and editing either occurrence updates both, live. Clear a value back to nothing and it simply reverts to showing the placeholder, rather than copying blank text.
  * The **Copy** button always copies exactly what's currently on the card — filled-in values where you've typed them, the literal `{{Placeholder}}` text anywhere you haven't.
* **"Why this works":** A dedicated section on the back of each card, rendered as full Markdown (not plain text), detailing the context and architectural logic behind the prompt's effectiveness. Only shown on cards that actually have this text.

### Tab 3: Code Snippets

A repository of reusable terminal/CLI command templates — curl, bash, PowerShell, cmd, Maven, git, and anything else you'd otherwise re-type or dig up from history.

* **Same card shape as Prompt Library:** search, tag filters, category groups, and the identical `{{Variable}}` fill-in-place engine — the two tools share one implementation rather than each keeping its own.
* **Category doubles as the language/tool label**, used both to group snippets and to pick the syntax-highlighting language for the snippet body — no separate field to fill in.
* **"Notes"** stands in for Prompt Library's "Why this works" on the card back, also rendered as full Markdown.

---

## 5. Multi-user, Authentication & Admin

* **Lock screen sign-in:** User ID + password, backed by Supabase Auth (default) or a server-side session (local/offline variant) — see § 3.
* **Roles:** one singleton Global Admin, standard Admins, and Normal Users, each scoped to their own LogBook/Prompt/Snippet data — admins manage accounts but never read other users' content ("data blindness").
* **Admin user management** is a list of quiet, collapsed rows; opening one reveals only the actions that role permits, the destructive one (hard delete) last and visually distinct from routine actions like a password reset.
* **Forced password rotation** on first login and after any admin-driven reset.
* **GDPR/PDPA-style account deletion** is a genuine hard delete with cascading removal of all of that user's data, not a soft-delete flag.

---

## 6. System Safety & Defensive Engineering

* **XSS Mitigation:** All interpreted Markdown strings — LogBook entries, prompts, and snippets alike — are thoroughly sanitized via `DOMPurify` before being mounted to the Document Object Model, as the last step of the render pipeline. The sanitizer configuration explicitly whitelists the specific structural tags and attributes needed by KaTeX, Mermaid SVG, and Prism token spans — nothing more. Narrow, hand-written exceptions are carved out with care rather than broad allow-listing: a rule recognizes literal `<sup>`/`<sub>` tags without opening the door to arbitrary HTML, and Mermaid diagram labels are extracted as plain text through a dedicated safe path rather than by trusting Mermaid's own HTML output directly.
* **Injection Prevention:** Both backends parameterize every data-layer query — PostgREST/RLS on Supabase, prepared SQLite statement bindings on the local variant — completely isolating search field strings and custom metadata Field names/values from database operations. Field values are restricted to plain text; structured data (objects, arrays) is rejected outright rather than accepted and flattened.
* **Per-user isolation:** enforced at the database engine via Postgres Row-Level Security on the default backend, and at the route layer (`WHERE user_id = ?` discipline) on the local variant.
* **Crash Isolation (Error Boundaries):** Compilation tasks for LaTeX formulas and Mermaid graphs run inside strict `try...catch` wrapper blocks. Syntax errors display a clean, localized fallback warning element rather than locking up the rendering lane.
* **LocalStorage Auto-Save:** The LogBook runs a background cache sequence every 10 seconds while an entry has unsaved changes. In the event of an unexpected page refresh or local network drop, Bento OS detects the cached draft on launch and prompts the user to restore their work — including any hand-edited Modified timestamp that hadn't been saved yet.
* **Focus Syncing:** A native listener intercepts the window `focus` event. When accessing the application from a second device or after backgrounding the tab, the frontend automatically refetches data rows to ensure the active workspace isn't stale — but never while you have unsaved edits open, so a background refresh can never silently overwrite work in progress.

---

## 7. Deployment & Licensing

Bento OS ships as a static `dist/` bundle plus, depending on the chosen backend, either nothing further (Supabase Cloud), a `docker compose` stack (self-hosted), or an Express process behind Tailscale (local/offline). Runtime libraries are vendored at build time rather than loaded from a CDN, in keeping with a strict Content-Security-Policy. The project is MIT-licensed, with third-party notices shipped alongside `dist/` for every vendored dependency that doesn't carry its own license banner upstream.

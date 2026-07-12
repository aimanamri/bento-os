# Project Brief: Bento OS (Local-First Productivity Suite) — Updated

> This is a revised version of [PROJECT-BRIEF.md](PROJECT-BRIEF.md),
> brought in line with the app as actually built. The original brief is
> kept as-is for history; this file is the current product description.
> For full technical detail behind every point below, see
> [docs/IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md),
> [docs/SECURITY.md](docs/SECURITY.md),
> [docs/EDGE-CASES.md](docs/EDGE-CASES.md), and
> [docs/UX-SPEC.md](docs/UX-SPEC.md) — those are the source of truth where
> this brief and they might ever disagree.

---

## 1. Project Overview

A local-first, lightweight web application designed to act as a personal knowledge base and prompt management system. **Bento OS** features a modular, macOS-inspired UI window metaphor with rich text layouts, acrylic blur effects (`backdrop-filter`), and a sleek dark-mode aesthetic.

Designed for single-user access hosted locally on a laptop and accessible securely outdoors via Tailscale, the app prioritizes high performance, complete data ownership, and bulletproof security. Phase 1 delivers two extensible core tools (Tabs): the **Docs LogBook** and the **Prompt Library**. Both are complete and running; this brief describes them as built, including a handful of refinements made after the initial Phase 1 delivery.

---

## 2. Integrated Tech Stack & Architecture

### Frontend Architecture

* **Core Engine:** Vanilla JavaScript (ES6+) for lean, programmatic DOM manipulation, dynamic component building, and data flow without framework overhead.
* **Styling & UI Framework:** **Tailwind CSS**. A utility-first compiler workflow deployed to enforce a strict design token system. Dark mode utilities (`dark:` modifiers) and backdrop utilities handle the custom macOS glassmorphism effects out-of-the-box.
* **Interactivity:** Native custom event architectures manage tab swapping, list updates, and ribbon actions cleanly without external state management libraries. In practice this stayed intentionally small — a handful of app-wide events (theme changes, entry dirty/saved state, tab switching) go through a shared event bus, while everything else is a direct function call within its own feature area.

### Backend Infrastructure

* **Server Layer:** Node.js with Express.js running a minimalist RESTful API to orchestrate client requests, database operations, and Markdown file imports/exports.
* **Database Engine:** SQLite embedded file database. Configured strictly in **WAL (Write-Ahead Logging) mode** to maintain high-speed concurrent read/write transactions, zero deployment overhead, and absolute local control.
* **Network & Deploys:** Tailscale overlay network handling secure point-to-point remote access, enabling outer-world access to the laptop host safely without public port forwarding.

### Core Utilities & Micro-Libraries

* `markdown-it` (High-speed Markdown parsing — settled on over `marked.js`)
* `KaTeX` (Fast, isolated LaTeX mathematical formula compiler)
* `Mermaid.js` (Dynamic runtime canvas/SVG charting and workflow diagram engine)
* `DOMPurify` (Strict client-side XSS prevention sanitization pipeline)

---

## 3. UI/UX Design System (The Bento Metaphor)

* **Window Aesthetics:** A fixed macOS-style application window frame utilizing crisp typography, smooth drop shadows, and responsive Tailwind layouts grid containers resembling a Japanese bento box.
* **Functional Traffic Lights:**
  * 🔴 **Red:** Minimizes the active page/tool down to a clean status dock.
  * 🟡 **Yellow:** Toggles Focus Mode (instantly collapses sidebars and auxiliary metadata panels for distraction-free writing using smooth transitions).
  * 🟢 **Green:** Toggles native browser fullscreen mode.
* **Reading vs. Editor Mode:** Opening an existing note lands you in a clean **Reading** view — just the rendered content, nothing to accidentally edit. A single icon toggle in the note header (hover shows its label) switches into **Editor** mode for the full authoring layout. Starting a brand-new note skips straight to Editor mode, since there's nothing to read yet.

---

## 4. Core Feature Specifications

### Tab 1: Docs LogBook (Default Homepage)

A workspace dedicated to logging deep technical notes, project post-mortems, and engineering guides.

* **Sidebar Navigation:** Tracks all saved entries, provides a live Search Box filtering across Titles, Tags, Summary, body text, and any custom metadata Fields (see below), and links to a helpful markdown usage **Guide Modal**.
* **Split Interface:** In Editor mode, provides a dual Editor/Preview view on wide viewports and a high-contrast toggle switch on narrower viewports. Reading mode shows only the rendered preview, centered at a comfortable reading width.
* **Sticky Tool Ribbon:** Anchored formatting toolbar offering quick-injection buttons for standard headings (H1-H3), bold/italic/strikethrough, **superscript and subscript**, inline code, links, **bulleted and numbered lists**, checkboxes, a 3x4 table generator, and code blocks. It also features pre-styled component blocks for `Success`, `Info`, and `Warning` alerts.
* **Syntax Reference (Bulb Icon):** A dropdown cheat sheet that injects exact boilerplate blocks for inline/block LaTeX mathematical formulas and Mermaid flowcharts directly into the cursor position.
* **Data Structure:**
  * *Title* (String, Required)
  * *Details/Solution* (Markdown Text, Required) — lives in an Editor-mode section explicitly labeled **Body**, describing the kind of content it's for (knowledge, solutions, troubleshooting, workarounds)
  * *Summary/Problem Statement* (Resizable text element) — a collapsible section positioned directly **above** the Body editor, open by default, minimum 3 visible lines
  * *Labels & Sub-labels* (Hierarchical structure; maps to `Uncategorized` if left blank)
  * *Tags* (Comma-separated array)
  * *Metadata:*
    * *Created* — an immutable UNIX timestamp, permanently read-only from the moment the entry is first saved
    * *Modified* — a UNIX timestamp that normally auto-updates on every save, but can also be **set by hand** to any specific date/time when you need to (e.g. backdating an imported note)
    * *Fields* — an open-ended set of your own name/value metadata (TiddlyWiki-style rows you add and remove freely), searchable from the sidebar. There is no fixed OS Platform dropdown or `isValid` checkbox baked into the schema — if you want either, add them as Fields (`os_platform: macOS`, `is_valid: true`); the mechanism is general-purpose rather than hardcoded to two specific properties.
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
* **"Why this works":** A dedicated prose section on the back of each card detailing the context and architectural logic behind the prompt's effectiveness. Only shown on cards that actually have this text.

---

## 5. System Safety & Defensive Engineering

* **XSS Mitigation:** All interpreted Markdown strings are thoroughly sanitized via `DOMPurify` before being mounted to the Document Object Model. The sanitizer configuration explicitly whitelists the specific structural tags and attributes needed by KaTeX and Mermaid SVG elements — nothing more. Two specific, narrow exceptions are carved out with care rather than broad allow-listing: a hand-written rule recognizes literal `<sup>`/`<sub>` tags (for superscript/subscript) without opening the door to arbitrary HTML, and Mermaid diagram labels are extracted as plain text through a dedicated safe path rather than by trusting Mermaid's own HTML output directly.
* **SQL Injection Prevention:** The Express backend uses strictly parameterized SQLite statement bindings for all data layers, completely isolating search field strings — and custom metadata Field names/values — from database operations. Field values are restricted to plain text; structured data (objects, arrays) is rejected outright rather than accepted and flattened.
* **Crash Isolation (Error Boundaries):** Compilation tasks for LaTeX formulas and Mermaid graphs run inside strict `try...catch` wrapper blocks. Syntax errors display a clean, localized fallback warning element rather than locking up the rendering lane.
* **LocalStorage Auto-Save:** The LogBook runs a background cache sequence every 10 seconds while an entry has unsaved changes. In the event of an unexpected page refresh or local network drop, Bento OS detects the cached draft on launch and prompts the user to restore their work — including any hand-edited Modified timestamp that hadn't been saved yet.
* **Tailscale Focus Syncing:** A native listener intercepts the window `focus` event. When accessing the application outdoors from a mobile client or secondary machine, the frontend automatically refetches data rows to ensure the active workspace isn't stale — but never while you have unsaved edits open, so a background refresh can never silently overwrite work in progress.

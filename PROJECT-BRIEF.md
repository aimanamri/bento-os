# Project Brief: Bento OS (Local-First Productivity Suite)

---

## 1. Project Overview

A local-first, lightweight web application designed to act as a personal knowledge base and prompt management system. **Bento OS** features a modular, macOS-inspired UI window metaphor with rich text layouts, acrylic blur effects (`backdrop-filter`), and a sleek dark-mode aesthetic.

Designed for single-user access hosted locally on a laptop and accessible securely outdoors via Tailscale, the app prioritizes high performance, complete data ownership, and bulletproof security. Phase 1 delivers two extensible core tools (Tabs): the **Docs LogBook** and the **Prompt Library**.

---

## 2. Integrated Tech Stack & Architecture

### Frontend Architecture

* **Core Engine:** Vanilla JavaScript (ES6+) for lean, programmatic DOM manipulation, dynamic component building, and data flow without framework overhead.
* **Styling & UI Framework:** **Tailwind CSS**. A utility-first compiler workflow deployed to enforce a strict design token system. Dark mode utilities (`dark:` modifiers) and backdrop utilities handle the custom macOS glassmorphism effects out-of-the-box.
* **Interactivity:** Native custom event architectures manage tab swapping, list updates, and ribbon actions cleanly without external state management libraries.

### Backend Infrastructure

* **Server Layer:** Node.js with Express.js running a minimalist RESTful API to orchestrate client requests, database operations, and Markdown file imports/exports.
* **Database Engine:** SQLite embedded file database. Configured strictly in **WAL (Write-Ahead Logging) mode** to maintain high-speed concurrent read/write transactions, zero deployment overhead, and absolute local control.
* **Network & Deploys:** Tailscale overlay network handling secure point-to-point remote decryption, enabling outer-world access to the laptop host safely without public port forwarding.

### Core Utilities & Micro-Libraries

* `marked.js` or `markdown-it` (High-speed Markdown parsing)
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



---

## 4. Core Feature Specifications

### Tab 1: Docs LogBook (Default Homepage)

A workspace dedicated to logging deep technical notes, project post-mortems, and engineering guides.

* **Sidebar Navigation:** Tracks all saved entries, provides a live Search Box filtering across Titles, Tags, and Metadata dropdowns, and links to a helpful markdown usage **Guide Modal**.
* **Split Interface:** Provides a dual Editor/Preview view on wide viewports and a high-contrast toggle switch on narrower viewports.
* **Sticky Tool Ribbon:** Anchored formatting toolbar offering quick-injection buttons for standard headings (H1-H3), code blocks, checkboxes, formatting syntax, and a 3x4 table generator. It also features pre-styled component blocks for `Success`, `Info`, and `Warning` alerts.
* **Syntax Reference (Bulb Icon):** A dropdown cheat sheet that injects exact boilerplate blocks for inline/block LaTeX mathematical formulas and Mermaid flowcharts directly into the cursor position.
* **Data Structure:**
* *Title* (String, Required)
* *Details/Solution* (Markdown Text, Required)
* *Labels & Sub-labels* (Hierarchical structure; maps to `Uncategorized` if left blank)
* *Tags* (Comma-separated array)
* *Metadata Block* (Immutable UNIX timestamp, customizable OS Platform dropdown, and boolean tracking properties like `isValid`)
* *Summary/Problem Statement* (Resizable text element)
* *URL Lists* (Collapsible container handling comma-separated web links)


* **Actions & Guards:** "Save Entry", "Import as Markdown File", "+ New Entry", "Close [x]". Triggers modal warnings if a user attempts to save a blank entry or close an unsaved, modified entry.

### Tab 2: Prompt Library

A structural repository for saving, tuning, and executing AI prompt templates.

* **Structural Layout:** Begins with a prominent top search bar, immediately followed by a tight row of pill-shaped tag filter buttons. Content organizes into distinct groups via small, all-caps category labels separated by generous vertical padding.
* **Prompt Cards:** Vertically stacked, rounded rectangular cards displaying a bold primary title, category data, and a monospace text container housing the prompt itself.
* **Dynamic Variable Substitution ("Fill In and Copy"):**
* Prompts can be saved using regex-scannable double-brace variables (e.g., `{{Topic}}` or `{{Programming Language}}`).
* Toggling "Fill In and Copy" dynamically generates temporary inline input text fields matching those variables directly on the card. Typing updates the copy buffer in real-time.


* **"Why this works":** A dedicated prose section on the back of each card detailing the context and architectural logic behind the prompt's effectiveness.

---

## 5. System Safety & Defensive Engineering

* **XSS Mitigation:** All interpreted Markdown strings are thoroughly sanitized via `DOMPurify` before being mounted to the Document Object Model. The sanitizer configuration explicitly whitelists the specific structural tags and attributes needed by KaTeX and Mermaid SVG elements.
* **SQL Injection Prevention:** The Express backend uses strictly parameterized SQLite statement bindings for all data layers, completely isolating search field strings from database operations.
* **Crash Isolation (Error Boundaries):** Compilation tasks for LaTeX formulas and Mermaid graphs run inside strict `try...catch` wrapper blocks. Syntax errors display a clean, localized fallback warning element rather than locking up the rendering lane.
* **LocalStorage Auto-Save:** The LogBook runs a background cache sequence every 10 seconds. In the event of an unexpected page refresh or local network drop, Bento OS detects the cached draft on launch and prompts the user to restore their work.
* **Tailscale Focus Syncing:** A native listener intercepts the window `focus` event. When accessing the application outdoors from a mobile client or secondary machine, the frontend automatically refetches data rows to ensure the active workspace isn't stale.
// Pre-auth tour — one dialog, one pane per tab, opened from the lock screen's
// dock pills (index.html #dlg-tour).
//
// Each pane keeps the same shape: two plain claims with a small preview, and
// one live demo of the thing a picture can't convey. The demos run the app's
// own code — renderMarkdown for the LogBook, the shared {{Variable}} engine
// for Prompts and Snippets — so the tour can never drift from the product.
// The vendored render libraries are global before app.js runs, so none of
// this costs the logged-out page an extra byte.

import { renderInto } from './render.js';
import { composeBody, buildEditableBody } from './vars.js';
import { copyText } from './clipboard.js';

const RENDER_DEBOUNCE_MS = 140; // KaTeX/Mermaid make each pass non-trivial

// Deliberately generic samples: the point is the mechanism, not the subject.
const MARKDOWN_SAMPLE = `## Anything worth finding later

Write in **plain markdown** and it renders as you type.

- the steps that actually worked
- a link you'll want again

\`one line of code\`
`;

const PROMPT_SAMPLE = 'Explain {{topic}} to a {{audience}} in {{count}} sentences.';
const SNIPPET_SAMPLE = 'git checkout -b {{branch-name}}';

let dlg = null;

/** Show one pane and mark its tab selected. */
function activate(name) {
  document.querySelectorAll('[data-tour-pane]').forEach((pane) => {
    const on = pane.dataset.tourPane === name;
    pane.classList.toggle('hidden', !on);
    pane.classList.toggle('flex', on);
  });
  document.querySelectorAll('[data-tour-tab]').forEach((tab) => {
    const on = tab.dataset.tourTab === name;
    tab.dataset.active = String(on);
    tab.setAttribute('aria-selected', String(on));
  });
}

function open(name) {
  if (!dlg) return;
  activate(name);
  if (!dlg.open) dlg.showModal();
}

/* ── LogBook: live markdown ─────────────────────────────────── */

function wireMarkdownDemo() {
  const input = document.getElementById('tour-md-in');
  const output = document.getElementById('tour-md-out');
  if (!input || !output) return;

  input.value = MARKDOWN_SAMPLE;

  let timer = null;
  let pending = false; // a render finished late while another edit landed
  const paint = async () => {
    pending = false;
    // renderInto runs the same sanitize-then-render pipeline the editor uses.
    await renderInto(output, input.value);
    if (pending) paint();
  };
  const schedule = () => {
    pending = true;
    clearTimeout(timer);
    timer = setTimeout(paint, RENDER_DEBOUNCE_MS);
  };

  input.addEventListener('input', schedule);
  paint();
}

/* ── Prompts + Snippets: the shared fill-in engine ──────────── */

function wireVariableDemo({ bodyId, copyId, template, language }) {
  const body = document.getElementById(bodyId);
  const copyBtn = document.getElementById(copyId);
  if (!body || !copyBtn) return;

  const values = new Map(); // buildEditableBody writes into this as you type
  buildEditableBody(body, template, values, language);

  // Same feedback the real cards use: the label confirms, and copyText's own
  // fallbacks handle a clipboard the browser won't give us.
  copyBtn.addEventListener('click', async () => {
    if (!(await copyText(composeBody(template, values)))) return;
    copyBtn.textContent = '✓ Copied';
    setTimeout(() => (copyBtn.textContent = 'Copy'), 1500);
  });
}

/* ── boot ───────────────────────────────────────────────────── */

export function initTour() {
  dlg = document.getElementById('dlg-tour');
  if (!dlg) return;

  document.querySelectorAll('[data-tour]').forEach((btn) => {
    btn.addEventListener('click', () => open(btn.dataset.tour));
  });
  document.querySelectorAll('[data-tour-tab]').forEach((tab) => {
    tab.addEventListener('click', () => activate(tab.dataset.tourTab));
  });

  wireMarkdownDemo();
  wireVariableDemo({
    bodyId: 'tour-prompt-body',
    copyId: 'tour-prompt-copy',
    template: PROMPT_SAMPLE,
    language: null,
  });
  wireVariableDemo({
    bodyId: 'tour-snippet-body',
    copyId: 'tour-snippet-copy',
    template: SNIPPET_SAMPLE,
    language: 'bash',
  });
}

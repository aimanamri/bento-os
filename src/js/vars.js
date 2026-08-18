// Shared {{Variable}} fill-in engine — used by both the Prompt Library and
// Code Snippets tabs (EDGE-CASES §5 grammar).

import { highlightInto } from './highlight.js';
import { t } from './i18n.js';

// Single scan, non-greedy, no nesting: {{ Name }} — §5 grammar.
const VAR_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

/** Ordered unique variable names, first-occurrence order (§5.1). */
export function parseVars(body) {
  const names = [];
  const seen = new Set();
  for (const m of body.matchAll(VAR_RE)) {
    const name = m[1];
    if (!seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

/** Substitute filled values; unfilled placeholders stay intact (§5.7). */
export function composeBody(body, values) {
  return body.replace(VAR_RE, (whole, name) => {
    const v = values.get(name);
    return v && v.trim() ? v : whole;
  });
}

/**
 * Render the body with each {{Variable}} as a directly-editable inline slot
 * — no separate "fill in" mode or input list. First focus selects the whole
 * slot so typing immediately replaces the placeholder, matching how a normal
 * form field behaves. Values are written straight into `values` on every
 * edit, so Copy always reflects what's on screen.
 *
 * `language` is optional and only the Snippets tab passes it (prompt bodies
 * are prose): the literal text around the slots is syntax-coloured, while the
 * slots themselves stay plain, editable, and visually distinct. Each run
 * between two slots is tokenized on its own, so a construct that a placeholder
 * splits in half — `"{{URL}}/path"` — colours by what is left of it rather
 * than bleeding across the slot.
 */
export function buildEditableBody(container, body, values, language = null) {
  container.textContent = '';
  const slotsByName = new Map(); // name -> span[], for live duplicate mirroring
  let last = 0;

  const appendLiteral = (text) => {
    if (!text) return;
    if (!language) {
      container.appendChild(document.createTextNode(text));
      return;
    }
    const run = document.createElement('span');
    highlightInto(run, text, language);
    while (run.firstChild) container.appendChild(run.firstChild);
  };

  const applyState = (span, placeholder) => {
    const text = span.textContent;
    const filled = text.trim() !== '' && text !== placeholder;
    span.classList.toggle('var-filled', filled);
    span.classList.toggle('var-empty', !filled);
  };

  for (const m of body.matchAll(VAR_RE)) {
    if (m.index > last) appendLiteral(body.slice(last, m.index));
    const name = m[1];
    const placeholder = m[0];
    const stored = values.get(name);

    const span = document.createElement('span');
    span.className = 'var-slot';
    span.contentEditable = 'true';
    span.spellcheck = false;
    span.setAttribute('role', 'textbox');
    span.setAttribute('aria-label', t('vars.valueFor', { name }));
    span.setAttribute('aria-multiline', 'false');
    span.dataset.varName = name;
    span.textContent = stored && stored.trim() ? stored : placeholder;
    applyState(span, placeholder);

    span.addEventListener('focus', () => {
      const range = document.createRange();
      range.selectNodeContents(span);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });

    span.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') e.preventDefault(); // values stay single-line
    });

    // Force plain-text paste — rich text would otherwise leave stray
    // formatting elements inside the slot.
    span.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text/plain').replace(/\s+/g, ' ');
      document.execCommand('insertText', false, text);
    });

    span.addEventListener('input', () => {
      const text = span.textContent;
      values.set(name, text);
      applyState(span, placeholder);
      // Duplicate occurrences mirror this one live (§5.1). Never touch the
      // span being actively typed in, so its caret is never stolen.
      for (const other of slotsByName.get(name) || []) {
        if (other !== span && other.textContent !== text) {
          other.textContent = text;
          applyState(other, placeholder);
        }
      }
    });

    // Clearing a slot reverts it to the placeholder rather than copying
    // nothing (§5.7: unfilled variables stay intact).
    span.addEventListener('blur', () => {
      if (span.textContent.trim() !== '') return;
      values.delete(name);
      for (const s of slotsByName.get(name) || []) {
        s.textContent = placeholder;
        applyState(s, placeholder);
      }
    });

    if (!slotsByName.has(name)) slotsByName.set(name, []);
    slotsByName.get(name).push(span);
    container.appendChild(span);
    last = m.index + placeholder.length;
  }
  if (last < body.length) appendLiteral(body.slice(last));
}

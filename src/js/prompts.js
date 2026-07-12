// Prompt Library — search, pill tag filters, category groups, card flip,
// and the {{Variable}} fill-in engine (EDGE-CASES §5).

import { api } from './api.js';
import { toast, confirmModal } from './ui.js';
import { copyText } from './clipboard.js';

// Single scan, non-greedy, no nesting: {{ Name }} — §5 grammar.
const VAR_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

const el = {
  search: document.getElementById('pr-search'),
  pills: document.getElementById('pr-pills'),
  groups: document.getElementById('pr-groups'),
  newBtn: document.getElementById('pr-new'),
  dlg: document.getElementById('dlg-prompt'),
  form: document.getElementById('prompt-form'),
  fTitle: document.getElementById('pf-title'),
  fCategory: document.getElementById('pf-category'),
  fTags: document.getElementById('pf-tags'),
  fBody: document.getElementById('pf-body'),
  fWhy: document.getElementById('pf-why'),
  fError: document.getElementById('pf-error'),
  dlgTitle: document.getElementById('dlg-prompt-title'),
};

const state = {
  prompts: [],
  activeTags: new Set(),
  editing: null, // prompt being edited in the dialog, or null for new
  fill: new Map(), // promptId -> Map(varName -> currently-typed value)
};

/* ── variable engine ────────────────────────────────────────── */

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
 * Render the prompt body with each {{Variable}} as a directly-editable
 * inline slot — no separate "fill in" mode or input list. First focus
 * selects the whole slot so typing immediately replaces the placeholder,
 * matching how a normal form field behaves. Values are written straight
 * into `values` on every edit, so Copy always reflects what's on screen.
 */
function buildEditableBody(container, body, values) {
  container.textContent = '';
  const slotsByName = new Map(); // name -> span[], for live duplicate mirroring
  let last = 0;

  const applyState = (span, placeholder) => {
    const text = span.textContent;
    const filled = text.trim() !== '' && text !== placeholder;
    span.classList.toggle('var-filled', filled);
    span.classList.toggle('var-empty', !filled);
  };

  for (const m of body.matchAll(VAR_RE)) {
    if (m.index > last) container.appendChild(document.createTextNode(body.slice(last, m.index)));
    const name = m[1];
    const placeholder = m[0];
    const stored = values.get(name);

    const span = document.createElement('span');
    span.className = 'var-slot';
    span.contentEditable = 'true';
    span.spellcheck = false;
    span.setAttribute('role', 'textbox');
    span.setAttribute('aria-label', `Value for ${name}`);
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
  if (last < body.length) container.appendChild(document.createTextNode(body.slice(last)));
}

/* ── data ───────────────────────────────────────────────────── */

async function load() {
  const params = new URLSearchParams();
  if (el.search.value.trim()) params.set('q', el.search.value.trim());
  const data = await api(`/api/prompts?${params}`);
  state.prompts = data.prompts;
  render();
}

function visiblePrompts() {
  if (state.activeTags.size === 0) return state.prompts;
  // OR across active tags, AND-composed with the server-side search
  return state.prompts.filter((p) =>
    p.tags.some((t) => state.activeTags.has(t.toLowerCase()))
  );
}

/* ── rendering ──────────────────────────────────────────────── */

function render() {
  renderPills();
  renderGroups();
}

function renderPills() {
  const tags = new Map(); // lower -> display
  for (const p of state.prompts) for (const t of p.tags) tags.set(t.toLowerCase(), t);
  // Drop active tags that no longer exist
  for (const t of [...state.activeTags]) if (!tags.has(t)) state.activeTags.delete(t);

  el.pills.textContent = '';
  if (tags.size === 0) return;

  const all = document.createElement('button');
  all.className = 'pill';
  all.textContent = 'All';
  all.setAttribute('aria-pressed', String(state.activeTags.size === 0));
  all.addEventListener('click', () => {
    state.activeTags.clear();
    render();
  });
  el.pills.appendChild(all);

  for (const [key, display] of [...tags.entries()].sort()) {
    const pill = document.createElement('button');
    pill.className = 'pill';
    pill.textContent = display;
    pill.setAttribute('aria-pressed', String(state.activeTags.has(key)));
    pill.addEventListener('click', () => {
      state.activeTags.has(key) ? state.activeTags.delete(key) : state.activeTags.add(key);
      render();
    });
    el.pills.appendChild(pill);
  }
}

function renderGroups() {
  el.groups.textContent = '';
  const visible = visiblePrompts();

  if (visible.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'flex flex-col items-center gap-3 py-16 text-center text-sm text-ink-muted';
    const msg = document.createElement('p');
    if (state.prompts.length === 0 && !el.search.value.trim()) {
      msg.textContent = 'No prompts yet. Save your first reusable template.';
      const cta = document.createElement('button');
      cta.className = 'btn btn-primary';
      cta.textContent = 'New Prompt';
      cta.addEventListener('click', () => openDialog(null));
      empty.append(msg, cta);
    } else {
      msg.textContent = el.search.value.trim()
        ? `Nothing matches “${el.search.value.trim()}”.`
        : 'Nothing matches the selected tags.';
      const clear = document.createElement('button');
      clear.className = 'btn';
      clear.textContent = 'Clear filters';
      clear.addEventListener('click', () => {
        el.search.value = '';
        state.activeTags.clear();
        load();
      });
      empty.append(msg, clear);
    }
    el.groups.appendChild(empty);
    return;
  }

  // Alphabetical all-caps category groups, generous vertical padding (§UX-4)
  const byCategory = new Map();
  for (const p of visible) {
    if (!byCategory.has(p.category)) byCategory.set(p.category, []);
    byCategory.get(p.category).push(p);
  }

  for (const [category, prompts] of [...byCategory.entries()].sort()) {
    const section = document.createElement('section');
    section.className = 'pt-8 first:pt-4';
    const h = document.createElement('h2');
    h.className = 'mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-ink-muted';
    h.textContent = category;
    section.appendChild(h);
    for (const p of prompts) section.appendChild(renderCard(p));
    el.groups.appendChild(section);
  }
}

function actionBtn(label, onClick, extra = '') {
  const b = document.createElement('button');
  b.className = 'btn text-xs ' + extra;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

// Icon-only action button. `label` is exposed both as the hover tooltip
// (native `title`) and the accessible name (`aria-label`) — same pattern as
// the LogBook's Reading/Editor and sidebar toggles.
const SVG_NS = 'http://www.w3.org/2000/svg';
function iconActionBtn(label, paths, onClick, extra = '') {
  const b = document.createElement('button');
  b.className = 'icon-btn btn-ghost ' + extra;
  b.title = label;
  b.setAttribute('aria-label', label);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  b.appendChild(svg);
  b.addEventListener('click', onClick);
  return b;
}

const EDIT_ICON = ['M12 20h9', 'M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z'];
const DELETE_ICON = ['M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6'];

function renderCard(p) {
  const fillValues = state.fill.get(p.id) || new Map();
  state.fill.set(p.id, fillValues);
  const vars = parseVars(p.body);

  const scene = document.createElement('article');
  scene.className = 'flip-scene mb-3';
  const inner = document.createElement('div');
  inner.className = 'flip-inner';
  scene.appendChild(inner);
  scene.dataset.flipped = 'false';

  /* front */
  const front = document.createElement('div');
  front.className = 'flip-front flex flex-col gap-3 rounded-card border border-edge bg-panel p-4 shadow-card';

  const head = document.createElement('div');
  head.className = 'flex items-start justify-between gap-2';
  const titleWrap = document.createElement('div');
  const title = document.createElement('h3');
  title.className = 'text-base font-bold';
  title.textContent = p.title;
  titleWrap.appendChild(title);
  if (p.tags.length) {
    const chips = document.createElement('div');
    chips.className = 'mt-1 flex flex-wrap gap-1';
    for (const t of p.tags) {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      chip.textContent = t;
      chips.appendChild(chip);
    }
    titleWrap.appendChild(chips);
  }
  head.appendChild(titleWrap);

  const editRow = document.createElement('div');
  editRow.className = 'flex flex-none gap-0.5';
  editRow.append(
    iconActionBtn('Edit prompt', EDIT_ICON, () => openDialog(p), 'text-ink-muted'),
    iconActionBtn('Delete prompt', DELETE_ICON, () => deletePrompt(p), 'text-ink-muted hover:text-danger')
  );
  head.appendChild(editRow);
  front.appendChild(head);

  const well = document.createElement('pre');
  well.className =
    'max-h-56 overflow-y-auto whitespace-pre-wrap rounded-md border border-edge bg-panel-2 p-3 font-mono text-xs leading-relaxed';
  if (vars.length) {
    buildEditableBody(well, p.body, fillValues);
  } else {
    well.textContent = p.body;
  }
  front.appendChild(well);

  if (vars.length) {
    const hint = document.createElement('p');
    hint.className = 'text-[11px] text-ink-muted';
    hint.textContent = 'Click a highlighted placeholder to fill it in.';
    front.appendChild(hint);
  }

  const actions = document.createElement('div');
  actions.className = 'flex flex-wrap items-center gap-1.5';

  const copyBtn = actionBtn('Copy', async () => {
    const text = vars.length ? composeBody(p.body, fillValues) : p.body;
    const ok = await copyText(text);
    if (ok) {
      copyBtn.textContent = '✓ Copied';
      setTimeout(() => (copyBtn.textContent = 'Copy'), 1500);
    }
  }, 'btn-primary');
  actions.appendChild(copyBtn);

  if (p.why_this_works && p.why_this_works.trim()) {
    actions.appendChild(
      actionBtn('Why this works', () => {
        scene.dataset.flipped = 'true';
        back.querySelector('button')?.focus();
      }, 'btn-ghost')
    );
  }
  front.appendChild(actions);

  /* back — "Why this works" prose (§UX-4) */
  const back = document.createElement('div');
  back.className = 'flip-back flex flex-col gap-3 rounded-card border border-accent/40 bg-panel p-4 shadow-card';
  const backHead = document.createElement('div');
  backHead.className = 'flex items-center justify-between gap-2';
  const backTitle = document.createElement('h3');
  backTitle.className = 'text-sm font-semibold text-accent';
  backTitle.textContent = 'Why this works';
  backHead.append(backTitle, actionBtn('Back', () => (scene.dataset.flipped = 'false'), 'btn-ghost'));
  const prose = document.createElement('p');
  prose.className = 'overflow-y-auto text-sm leading-relaxed text-ink-muted';
  prose.textContent = p.why_this_works || '';
  back.append(backHead, prose);

  inner.append(front, back);
  return scene;
}

/* ── CRUD dialog ────────────────────────────────────────────── */

function openDialog(prompt) {
  state.editing = prompt;
  el.dlgTitle.textContent = prompt ? 'Edit Prompt' : 'New Prompt';
  el.fTitle.value = prompt?.title || '';
  el.fCategory.value = prompt?.category || '';
  el.fTags.value = (prompt?.tags || []).join(', ');
  el.fBody.value = prompt?.body || '';
  el.fWhy.value = prompt?.why_this_works || '';
  el.fError.classList.add('hidden');
  el.dlg.showModal();
  el.fTitle.focus();
}

async function submitDialog(e) {
  e.preventDefault();
  const body = {
    title: el.fTitle.value,
    category: el.fCategory.value,
    tags: el.fTags.value,
    body: el.fBody.value,
    why_this_works: el.fWhy.value,
  };
  if (!body.title.trim() || !body.body.trim()) {
    el.fError.textContent = 'A prompt needs both a title and prompt text.';
    el.fError.classList.remove('hidden');
    (!body.title.trim() ? el.fTitle : el.fBody).focus();
    return;
  }
  try {
    if (state.editing) {
      await api(`/api/prompts/${state.editing.id}`, {
        method: 'PUT',
        body: { ...body, expected_updated_at: state.editing.updated_at },
      });
    } else {
      await api('/api/prompts', { method: 'POST', body });
    }
    el.dlg.close();
    toast(state.editing ? 'Prompt updated' : 'Prompt saved', 'ok');
    await load();
  } catch (err) {
    if (err.status === 409) {
      el.dlg.close();
      const choice = await confirmModal({
        title: 'Saved on another device',
        body: 'This prompt changed on the server since you opened it.',
        actions: [
          { label: 'Reload theirs', value: 'reload', style: 'primary' },
          { label: 'Overwrite theirs', value: 'overwrite', style: 'danger' },
        ],
      });
      if (choice === 'overwrite') {
        state.editing = err.payload.prompt;
        el.dlg.showModal();
        await submitDialog(e);
      } else {
        await load();
      }
      return;
    }
    el.fError.textContent = err.message;
    el.fError.classList.remove('hidden');
  }
}

async function deletePrompt(p) {
  const choice = await confirmModal({
    title: 'Delete this prompt?',
    body: `“${p.title}” will be permanently deleted.`,
    actions: [
      { label: 'Cancel', value: 'cancel', style: 'primary' },
      { label: 'Delete', value: 'delete', style: 'danger' },
    ],
  });
  if (choice !== 'delete') return;
  try {
    await api(`/api/prompts/${p.id}`, { method: 'DELETE' });
    state.fill.delete(p.id);
    toast('Prompt deleted', 'ok');
    await load();
  } catch (e) {
    toast(e.message, 'err');
  }
}

/* ── init ───────────────────────────────────────────────────── */

export async function initPrompts() {
  let searchTimer = null;
  el.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => load().catch(() => {}), 200);
  });
  el.newBtn.addEventListener('click', () => openDialog(null));
  el.form.addEventListener('submit', submitDialog);

  try {
    await load();
  } catch (e) {
    toast("Couldn't load prompts", 'err');
  }
}

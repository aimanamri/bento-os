// Code Snippets — search, pill tag filters, language/tool category groups,
// card flip, and the shared {{Variable}} fill-in engine (EDGE-CASES §5).

import { api } from './api.js';
import { toast, confirmModal } from './ui.js';
import { t } from './i18n.js';
import { on } from './bus.js';
import { copyText } from './clipboard.js';
import { parseVars, composeBody, buildEditableBody } from './vars.js';
import { highlightInto, languageOf } from './highlight.js';
import { renderProseOnce } from './render.js';

const el = {
  search: document.getElementById('sn-search'),
  pills: document.getElementById('sn-pills'),
  groups: document.getElementById('sn-groups'),
  newBtn: document.getElementById('sn-new'),
  dlg: document.getElementById('dlg-snippet'),
  form: document.getElementById('snippet-form'),
  fTitle: document.getElementById('sf-title'),
  fCategory: document.getElementById('sf-category'),
  fTags: document.getElementById('sf-tags'),
  fBody: document.getElementById('sf-body'),
  fNotes: document.getElementById('sf-notes'),
  fError: document.getElementById('sf-error'),
  dlgTitle: document.getElementById('dlg-snippet-title'),
};

const state = {
  snippets: [],
  activeTags: new Set(),
  editing: null, // snippet being edited in the dialog, or null for new
  fill: new Map(), // snippetId -> Map(varName -> currently-typed value)
};

/* ── category color accent ─────────────────────────────────────
   Deterministic hue from the category string so any Language/Tool the
   user types (BASH, POWERSHELL, GIT, MAVEN, ...) gets a stable, distinct
   accent with no hardcoded color table to maintain. */
function categoryHue(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return hash % 360;
}

/* ── data ───────────────────────────────────────────────────── */

async function load() {
  const params = new URLSearchParams();
  if (el.search.value.trim()) params.set('q', el.search.value.trim());
  const data = await api(`/api/snippets?${params}`);
  state.snippets = data.snippets;
  render();
}

function visibleSnippets() {
  if (state.activeTags.size === 0) return state.snippets;
  // OR across active tags, AND-composed with the server-side search
  return state.snippets.filter((s) =>
    s.tags.some((t) => state.activeTags.has(t.toLowerCase()))
  );
}

/* ── rendering ──────────────────────────────────────────────── */

function render() {
  renderPills();
  renderGroups();
}

function renderPills() {
  const tags = new Map(); // lower -> display
  for (const s of state.snippets) for (const t of s.tags) tags.set(t.toLowerCase(), t);
  // Drop active tags that no longer exist
  for (const t of [...state.activeTags]) if (!tags.has(t)) state.activeTags.delete(t);

  el.pills.textContent = '';
  if (tags.size === 0) return;

  const all = document.createElement('button');
  all.className = 'pill';
  all.textContent = t('common.all');
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
  const visible = visibleSnippets();

  if (visible.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'flex flex-col items-center gap-3 py-16 text-center text-sm text-ink-muted';
    const msg = document.createElement('p');
    if (state.snippets.length === 0 && !el.search.value.trim()) {
      msg.textContent = t('sn.empty');
      const cta = document.createElement('button');
      cta.className = 'btn btn-primary';
      cta.textContent = t('sn.new');
      cta.addEventListener('click', () => openDialog(null));
      empty.append(msg, cta);
    } else {
      msg.textContent = el.search.value.trim()
        ? t('common.noMatchQuery', { q: el.search.value.trim() })
        : t('common.noMatchTags');
      const clear = document.createElement('button');
      clear.className = 'btn';
      clear.textContent = t('common.clearFilters');
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

  // Alphabetical all-caps category (Language/Tool) groups, generous vertical
  // padding (§UX-4), each with a deterministic color accent by hue.
  const byCategory = new Map();
  for (const s of visible) {
    if (!byCategory.has(s.category)) byCategory.set(s.category, []);
    byCategory.get(s.category).push(s);
  }

  for (const [category, snippets] of [...byCategory.entries()].sort()) {
    const hue = categoryHue(category);
    const section = document.createElement('section');
    section.className = 'pt-8 first:pt-4';
    const h = document.createElement('h2');
    h.className = 'mb-3 flex items-center text-xs font-semibold uppercase tracking-[0.14em] text-ink-muted';
    h.style.setProperty('--cat-hue', String(hue));
    const dot = document.createElement('span');
    dot.className = 'cat-dot';
    dot.setAttribute('aria-hidden', 'true');
    h.append(dot, document.createTextNode(category));
    section.appendChild(h);
    for (const s of snippets) section.appendChild(renderCard(s, hue));
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

function renderCard(s, hue) {
  const fillValues = state.fill.get(s.id) || new Map();
  state.fill.set(s.id, fillValues);
  const vars = parseVars(s.body);

  const scene = document.createElement('article');
  scene.className = 'flip-scene mb-3';
  scene.style.setProperty('--cat-hue', String(hue));
  const inner = document.createElement('div');
  inner.className = 'flip-inner';
  scene.appendChild(inner);
  scene.dataset.flipped = 'false';

  /* front */
  const front = document.createElement('div');
  front.className =
    'cat-accent flip-front flex flex-col gap-3 rounded-card border border-edge bg-panel p-4 shadow-card';

  const head = document.createElement('div');
  head.className = 'flex items-start justify-between gap-2';
  const titleWrap = document.createElement('div');
  const title = document.createElement('h3');
  title.className = 'text-base font-bold';
  title.textContent = s.title;
  titleWrap.appendChild(title);
  if (s.tags.length) {
    const chips = document.createElement('div');
    chips.className = 'mt-1 flex flex-wrap gap-1';
    for (const t of s.tags) {
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
    iconActionBtn(t('sn.edit'), EDIT_ICON, () => openDialog(s), 'text-ink-muted'),
    iconActionBtn(t('sn.delete'), DELETE_ICON, () => deleteSnippet(s), 'text-ink-muted hover:text-danger')
  );
  head.appendChild(editRow);
  front.appendChild(head);

  const well = document.createElement('pre');
  well.className =
    'max-h-56 overflow-y-auto whitespace-pre-wrap rounded-md border border-edge bg-panel-2 p-3 font-mono text-xs leading-relaxed';
  // `category` doubles as the language/tool label (004-snippets.sql), so it is
  // what the highlighter gets; anything it doesn't recognise ("GENERAL") comes
  // back as plain text.
  const lang = languageOf(s.category);
  if (vars.length) {
    buildEditableBody(well, s.body, fillValues, lang);
  } else {
    highlightInto(well, s.body, lang);
  }
  front.appendChild(well);

  if (vars.length) {
    const hint = document.createElement('p');
    hint.className = 'text-[11px] text-ink-muted';
    hint.textContent = t('common.placeholderHint');
    front.appendChild(hint);
  }

  const actions = document.createElement('div');
  actions.className = 'flex flex-wrap items-center gap-1.5';

  const copyBtn = actionBtn(t('common.copy'), async () => {
    const text = vars.length ? composeBody(s.body, fillValues) : s.body;
    const ok = await copyText(text);
    if (ok) {
      copyBtn.textContent = t('common.copied');
      setTimeout(() => (copyBtn.textContent = t('common.copy')), 1500);
    }
  }, 'btn-primary');
  actions.appendChild(copyBtn);

  if (s.notes && s.notes.trim()) {
    actions.appendChild(
      actionBtn(t('sn.notes'), () => {
        scene.dataset.flipped = 'true';
        renderProseOnce(prose, s.notes);
        back.querySelector('button')?.focus();
      }, 'btn-ghost')
    );
  }
  front.appendChild(actions);

  /* back — notes prose (§UX-4) */
  const back = document.createElement('div');
  back.className =
    'cat-accent flip-back flex flex-col gap-3 rounded-card border border-accent/40 bg-panel p-4 shadow-card';
  const backHead = document.createElement('div');
  backHead.className = 'flex items-center justify-between gap-2';
  const backTitle = document.createElement('h3');
  backTitle.className = 'text-sm font-semibold text-accent';
  backTitle.textContent = t('sn.notes');
  backHead.append(backTitle, actionBtn(t('common.back'), () => (scene.dataset.flipped = 'false'), 'btn-ghost'));
  // Markdown, through the same sanitize-then-render pipeline the LogBook
  // uses (SECURITY.md §2). A <div>, not a <p>: the pipeline emits block
  // elements, and a <p> would be closed early by the parser.
  const prose = document.createElement('div');
  prose.className = 'md-preview card-prose overflow-y-auto';
  back.append(backHead, prose);

  inner.append(front, back);
  return scene;
}

/* ── CRUD dialog ────────────────────────────────────────────── */

function openDialog(snippet) {
  state.editing = snippet;
  el.dlgTitle.textContent = t(snippet ? 'sn.dlg.edit' : 'sn.dlg.new');
  el.fTitle.value = snippet?.title || '';
  el.fCategory.value = snippet?.category || '';
  el.fTags.value = (snippet?.tags || []).join(', ');
  el.fBody.value = snippet?.body || '';
  el.fNotes.value = snippet?.notes || '';
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
    notes: el.fNotes.value,
  };
  if (!body.title.trim() || !body.body.trim()) {
    el.fError.textContent = t('sn.err.required');
    el.fError.classList.remove('hidden');
    (!body.title.trim() ? el.fTitle : el.fBody).focus();
    return;
  }
  try {
    if (state.editing) {
      await api(`/api/snippets/${state.editing.id}`, {
        method: 'PUT',
        body: { ...body, expected_updated_at: state.editing.updated_at },
      });
    } else {
      await api('/api/snippets', { method: 'POST', body });
    }
    el.dlg.close();
    toast(t(state.editing ? 'sn.toast.updated' : 'sn.toast.saved'), 'ok');
    await load();
  } catch (err) {
    if (err.status === 409) {
      el.dlg.close();
      const choice = await confirmModal({
        title: t('common.savedElsewhere'),
        body: t('sn.conflict.body'),
        actions: [
          { label: t('common.reloadTheirs'), value: 'reload', style: 'primary' },
          { label: t('common.overwriteTheirs'), value: 'overwrite', style: 'danger' },
        ],
      });
      if (choice === 'overwrite') {
        state.editing = err.payload.snippet;
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

async function deleteSnippet(s) {
  const choice = await confirmModal({
    title: t('sn.delete.title'),
    body: t('common.willBeDeleted', { title: s.title }),
    actions: [
      { label: t('common.cancel'), value: 'cancel', style: 'primary' },
      { label: t('common.delete'), value: 'delete', style: 'danger' },
    ],
  });
  if (choice !== 'delete') return;
  try {
    await api(`/api/snippets/${s.id}`, { method: 'DELETE' });
    state.fill.delete(s.id);
    toast(t('sn.toast.deleted'), 'ok');
    await load();
  } catch (e) {
    toast(e.message, 'err');
  }
}

/* ── init ───────────────────────────────────────────────────── */

export async function initSnippets() {
  let searchTimer = null;
  el.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => load().catch(() => {}), 200);
  });
  el.newBtn.addEventListener('click', () => openDialog(null));
  el.form.addEventListener('submit', submitDialog);

  // Cards are drawn here, not in the markup, so the DOM walker cannot reach
  // them — redraw the whole list instead.
  on('locale:changed', () => {
    renderPills();
    renderGroups();
  });

  try {
    await load();
  } catch (e) {
    toast(t('sn.toast.loadFailed'), 'err');
  }
}

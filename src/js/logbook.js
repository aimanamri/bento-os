// Docs LogBook — sidebar, editor/preview, guards, autosave, multi-device
// sync. Every behavior here traces to a row in docs/EDGE-CASES.md.

import { api, ApiError } from './api.js';
import { emit, on } from './bus.js';
import { toast, confirmModal, showBanner, clearBanner, announce, relativeTime, formatStamp } from './ui.js';
import { renderInto, renderMarkdown } from './render.js';
import { initRibbon, GUIDE_MD } from './ribbon.js';
import { copyText } from './clipboard.js';

const DRAFT_KEY = 'bento.draft.v1';

const el = {
  sidebar: document.getElementById('lb-sidebar'),
  sidebarToggle: document.getElementById('lb-sidebar-toggle'),
  list: document.getElementById('lb-list'),
  search: document.getElementById('lb-search'),
  groupToggle: document.getElementById('lb-grouptoggle'),
  tagPills: document.getElementById('lb-tagpills'),
  newBtn: document.getElementById('lb-new'),
  importBtn: document.getElementById('lb-import'),
  fileInput: document.getElementById('lb-file'),
  guideBtn: document.getElementById('lb-guide'),
  title: document.getElementById('lb-title'),
  editor: document.getElementById('lb-editor'),
  preview: document.getElementById('lb-preview'),
  previewPane: document.getElementById('lb-preview-pane'),
  editorPane: document.getElementById('lb-editor-pane'),
  divider: document.getElementById('lb-divider'),
  saveBtn: document.getElementById('lb-save'),
  closeBtn: document.getElementById('lb-close'),
  empty: document.getElementById('lb-empty'),
  emptyNewBtn: document.getElementById('lb-empty-new'),
  deleteBtn: document.getElementById('lb-delete'),
  editedHint: document.getElementById('lb-edited-hint'),
  workspace: document.getElementById('lb-workspace'),
  modeToggle: document.getElementById('lb-mode-toggle'),
  viewToggle: document.getElementById('lb-viewtoggle'),
  drawerOpen: document.getElementById('lb-drawer-open'),
  metaToggle: document.getElementById('lb-meta-toggle'),
  metaPanel: document.getElementById('lb-meta'),
  metaClose: document.getElementById('lb-meta-close'),
  summary: document.getElementById('meta-summary'),
  summaryWrap: document.getElementById('lb-summary-wrap'),
  label: document.getElementById('meta-label'),
  labelOptions: document.getElementById('label-options'),
  sublabel: document.getElementById('meta-sublabel'),
  tags: document.getElementById('meta-tags'),
  tagChips: document.getElementById('meta-tag-chips'),
  fields: document.getElementById('meta-fields'),
  fieldAddName: document.getElementById('field-add-name'),
  fieldAddValue: document.getElementById('field-add-value'),
  fieldAddBtn: document.getElementById('field-add-btn'),
  fieldAddError: document.getElementById('field-add-error'),
  fieldNameOptions: document.getElementById('field-name-options'),
  created: document.getElementById('meta-created'),
  modified: document.getElementById('meta-modified'),
  urls: document.getElementById('meta-urls'),
  urlItems: document.getElementById('meta-url-items'),
  urlCount: document.getElementById('meta-url-count'),
};

const state = {
  list: [],
  current: null, // full entry from server, or null for a new unsaved entry
  groupMode: 'flat', // 'flat' | 'label' | 'year' — sidebar organization
  activeTags: new Set(), // lowercased tag names currently filtering the sidebar (OR semantics)
  fields: new Map(), // user-defined metadata: name -> value (insertion-ordered)
  modifiedEdited: false, // true once the user hand-edits the Modified field
  dirty: false,
  lsAvailable: true,
  quotaWarned: false,
  lastFocusSync: 0,
  saving: false,
};

// Set by initMetaPanel — closes the narrow-screen metadata sheet, if it's up.
let dismissMetaSheet = () => {};

/* ── dirty tracking ─────────────────────────────────────────── */

function setDirty(v) {
  if (state.dirty === v) return;
  state.dirty = v;
  el.editedHint.classList.toggle('hidden', !v);
  emit('entry:dirty', { isDirty: v });
  // beforeunload registered only while dirty — keeps bfcache healthy (§1.3)
  if (v) window.addEventListener('beforeunload', onBeforeUnload);
  else window.removeEventListener('beforeunload', onBeforeUnload);
}
function onBeforeUnload(e) {
  e.preventDefault();
  e.returnValue = '';
}

/* ── form <-> data ──────────────────────────────────────────── */

// UNIX ms <-> the <input type="datetime-local"> value string (local time,
// second precision). The concurrency token (state.current.updated_at) is
// always read from state at full ms precision — never reconstructed from
// this field — so displaying it at second precision can't corrupt it.
function toLocalInputValue(ms) {
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function parseLocalInputValue(str) {
  if (!str) return null;
  const ms = new Date(str).getTime(); // parsed as local time
  return Number.isFinite(ms) ? ms : null;
}

function normalizeTagsClient(str) {
  const seen = new Set();
  const out = [];
  for (const raw of String(str).split(',')) {
    const t = raw.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

function collectForm() {
  return {
    title: el.title.value,
    body_md: el.editor.value,
    summary: el.summary.value,
    label: el.label.value.trim() || 'Uncategorized',
    sublabel: el.sublabel.value.trim() || null,
    tags: normalizeTagsClient(el.tags.value),
    fields: Object.fromEntries(state.fields),
    urls: el.urls.value.split(',').map((s) => s.trim()).filter(Boolean),
  };
}

function fillForm(data) {
  el.title.value = data.title || '';
  el.editor.value = data.body_md || '';
  el.summary.value = data.summary || '';
  el.label.value = !data.label || data.label === 'Uncategorized' ? '' : data.label;
  el.sublabel.value = data.sublabel || '';
  el.tags.value = (data.tags || []).join(', ');
  state.fields = new Map(Object.entries(data.fields || {}));
  el.urls.value = (data.urls || []).join(', ');

  // Modified field: a draft snapshot carries the raw input string + edit
  // flag; a server entry carries updated_at (ms). A brand-new entry has
  // neither → default to now.
  if (data._modified !== undefined) {
    el.modified.value = data._modified;
    state.modifiedEdited = !!data._modifiedEdited;
  } else {
    el.modified.value = toLocalInputValue(data.updated_at ?? Date.now());
    state.modifiedEdited = false;
  }

  renderFieldRows();
  syncMetaWidgets();
  renderCreated();
  schedulePreview(0);
}

/* ── Reading vs Editor mode ─────────────────────────────────── */

// Opening an entry lands in Reading mode (rendered preview only); the toggle
// or "New Entry" switches to Editor mode. Icon + hover label reflect the
// current mode. 'empty' is the third mode — no entry open at all.
function setMode(mode) {
  el.workspace.dataset.mode = mode;
  if (mode === 'empty') return; // the toggle is hidden; nothing to describe
  const reading = mode === 'read';
  el.modeToggle.querySelector('.mode-icon-read').classList.toggle('hidden', !reading);
  el.modeToggle.querySelector('.mode-icon-edit').classList.toggle('hidden', reading);
  el.modeToggle.title = reading ? 'Reading mode — click to edit' : 'Editor mode — click to read';
  el.modeToggle.setAttribute('aria-label', reading ? 'Reading mode (switch to editor)' : 'Editor mode (switch to reading)');
  el.modeToggle.setAttribute('aria-pressed', String(reading));
  if (reading) schedulePreview(0); // make sure the preview reflects current content
}

// Created is read-only (immutable). Called from fillForm and after a save.
function renderCreated() {
  if (state.current) {
    el.created.textContent = formatStamp(state.current.created_at);
    el.created.title = `UNIX ms: ${state.current.created_at}`;
  } else {
    el.created.textContent = '— (set on first save)';
    el.created.title = '';
  }
  el.deleteBtn.classList.toggle('hidden', !state.current);
}

// After a successful save, resync both timestamps to the stored values and
// clear the manual-edit flag.
function syncTimestampsFromCurrent() {
  renderCreated();
  el.modified.value = toLocalInputValue(state.current.updated_at);
  state.modifiedEdited = false;
}

// Tag chips, URL validity markers, sublabel gating (EDGE-CASES §6.1/6.3/6.4)
function syncMetaWidgets() {
  el.tagChips.textContent = '';
  for (const t of normalizeTagsClient(el.tags.value)) {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.textContent = t;
    el.tagChips.appendChild(chip);
  }

  const hasLabel = el.label.value.trim().length > 0;
  el.sublabel.disabled = !hasLabel;
  el.sublabel.placeholder = hasLabel ? 'optional' : 'needs a label first';
  if (!hasLabel) el.sublabel.value = '';

  renderUrlItems();
}

// Small inline icon for a URL chip — built as SVG nodes, never innerHTML.
function chipIcon(path) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'url-chip-icon');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', path);
  svg.appendChild(p);
  return svg;
}

const ICON_LINK = 'M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71';
const ICON_WARN = 'M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z';

// The rendered list lives outside the collapsible <details>, so it stays on
// screen whether the editor is open or shut. Long URLs wrap to at most two
// lines (full value in the tooltip) — one chip per row reads the same on a
// 288px desktop panel and on a phone.
function renderUrlItems() {
  const items = el.urls.value.split(',').map((s) => s.trim()).filter(Boolean);

  el.urlCount.textContent = String(items.length);
  el.urlCount.classList.toggle('hidden', items.length === 0);
  el.urlCount.title = `${items.length} link${items.length === 1 ? '' : 's'}`;

  el.urlItems.textContent = '';
  for (const item of items) {
    const valid = /^https?:\/\/\S+$/i.test(item);
    const row = document.createElement(valid ? 'a' : 'span');
    row.className = valid ? 'url-chip' : 'url-chip url-chip-bad';
    if (valid) {
      row.href = item;
      row.target = '_blank';
      row.rel = 'noopener noreferrer';
      row.title = item;
    } else {
      row.title = `${item}\nNot a valid http(s) URL — kept as a note`;
    }
    row.appendChild(chipIcon(valid ? ICON_LINK : ICON_WARN));
    const text = document.createElement('span');
    text.className = 'url-chip-text';
    // Drop the scheme (and any trailing slash) so the meaningful part of the
    // URL wins the limited width; the tooltip and href keep the original.
    text.textContent = valid ? item.replace(/^https?:\/\//i, '').replace(/\/$/, '') : item;
    row.appendChild(text);
    el.urlItems.appendChild(row);
  }
}

/* ── user-defined metadata fields (TiddlyWiki-style rows) ───── */

function fieldError(msg) {
  el.fieldAddError.textContent = msg || '';
  el.fieldAddError.classList.toggle('hidden', !msg);
}

function renderFieldRows() {
  el.fields.textContent = '';
  if (state.fields.size === 0) {
    const empty = document.createElement('p');
    empty.className = 'text-[11px] text-ink-muted/70';
    empty.textContent = 'No fields yet — add one below (e.g. os_platform, is_valid).';
    el.fields.appendChild(empty);
  }
  for (const [name, value] of state.fields) {
    const row = document.createElement('div');
    row.className = 'flex items-center gap-1.5';

    const nameEl = document.createElement('span');
    nameEl.className = 'w-24 flex-none truncate text-right text-xs text-ink-muted';
    nameEl.textContent = `${name}:`;
    nameEl.title = name;

    const valueEl = document.createElement('input');
    valueEl.className = 'input !py-1 min-w-0 flex-1 text-xs';
    valueEl.value = value;
    valueEl.maxLength = 2000;
    valueEl.setAttribute('aria-label', `Value for field ${name}`);
    valueEl.addEventListener('input', () => {
      state.fields.set(name, valueEl.value);
      setDirty(true);
    });

    const del = document.createElement('button');
    del.className = 'icon-btn btn-ghost !p-1 text-ink-muted hover:text-danger';
    del.setAttribute('aria-label', `Remove field ${name}`);
    del.title = `Remove ${name}`;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'icon !h-3.5 !w-3.5');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6');
    svg.appendChild(path);
    del.appendChild(svg);
    del.addEventListener('click', () => {
      state.fields.delete(name);
      setDirty(true);
      renderFieldRows();
    });

    row.append(nameEl, valueEl, del);
    el.fields.appendChild(row);
  }
  refreshFieldNameSuggestions();
}

// Suggest field names already used on other entries (the ▾ affordance in
// the reference design) — minus the ones this entry already has.
function refreshFieldNameSuggestions() {
  const used = new Set([...state.fields.keys()].map((n) => n.toLowerCase()));
  const names = new Map(); // lower -> display
  for (const row of state.list) {
    for (const n of Object.keys(row.fields || {})) {
      const key = n.toLowerCase();
      if (!used.has(key) && !names.has(key)) names.set(key, n);
    }
  }
  el.fieldNameOptions.textContent = '';
  for (const [, display] of [...names.entries()].sort()) {
    const opt = document.createElement('option');
    opt.value = display;
    el.fieldNameOptions.appendChild(opt);
  }
}

function addField() {
  const name = el.fieldAddName.value.trim();
  const value = el.fieldAddValue.value.trim();
  if (!name) {
    fieldError('Give the field a name.');
    el.fieldAddName.focus();
    return;
  }
  const exists = [...state.fields.keys()].some((n) => n.toLowerCase() === name.toLowerCase());
  if (exists) {
    fieldError(`A field named “${name}” already exists on this entry.`);
    el.fieldAddName.focus();
    return;
  }
  fieldError('');
  state.fields.set(name, value);
  setDirty(true);
  el.fieldAddName.value = '';
  el.fieldAddValue.value = '';
  renderFieldRows();
  el.fieldAddName.focus();
}

/* ── preview rendering (adaptive debounce, §4.4) ────────────── */

let previewTimer = null;
let lastRenderMs = 0;
function schedulePreview(delay = null) {
  clearTimeout(previewTimer);
  const wait = delay !== null ? delay : lastRenderMs > 600 ? 1200 : 300;
  previewTimer = setTimeout(async () => {
    const t0 = performance.now();
    try {
      await renderInto(el.preview, el.editor.value);
    } catch (e) {
      el.preview.textContent = 'Preview failed to render.';
    }
    lastRenderMs = performance.now() - t0;
  }, wait);
}

/* ── sidebar list ───────────────────────────────────────────── */

async function loadList(q = el.search.value) {
  const params = new URLSearchParams();
  if (q && q.trim()) params.set('q', q.trim());
  const data = await api(`/api/entries?${params}`);
  state.list = data.entries;
  renderList();
  return state.list;
}

/** One entry row — extracted so both flat and grouped rendering share it. */
function renderEntryRow(row) {
  const btn = document.createElement('button');
  btn.className = 'entry-row';
  btn.setAttribute('role', 'listitem');
  if (state.current && state.current.id === row.id) btn.setAttribute('aria-current', 'true');

  const title = document.createElement('div');
  title.className = 'truncate text-sm font-medium';
  title.textContent = row.title;
  title.title = row.title;

  const meta = document.createElement('div');
  meta.className = 'mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-muted';
  const crumb = document.createElement('span');
  crumb.className = 'truncate';
  crumb.textContent = row.sublabel ? `${row.label} › ${row.sublabel}` : row.label;
  const when = document.createElement('span');
  when.className = 'ml-auto whitespace-nowrap';
  when.textContent = relativeTime(row.updated_at);
  when.title = formatStamp(row.updated_at);
  meta.append(crumb, when);

  btn.append(title, meta);
  btn.addEventListener('click', () => guardThen(() => openEntry(row.id)));
  return btn;
}

/**
 * Bucket a (already search/tag-filtered) list per the active group mode.
 * Returns [{ key, heading, entries }]. 'flat' returns a single bucket.
 */
function groupEntries(list, mode) {
  if (mode === 'flat') return [{ key: null, heading: null, entries: list }];

  if (mode === 'year') {
    const byYear = new Map();
    for (const row of list) {
      const year = String(new Date(row.updated_at).getFullYear());
      if (!byYear.has(year)) byYear.set(year, []);
      byYear.get(year).push(row);
    }
    return [...byYear.entries()]
      .sort((a, b) => b[0].localeCompare(a[0])) // newest year first
      .map(([year, entries]) => ({ key: year, heading: year, entries }));
  }

  // label — Uncategorized always last, everything else alphabetical
  const byLabel = new Map();
  for (const row of list) {
    if (!byLabel.has(row.label)) byLabel.set(row.label, []);
    byLabel.get(row.label).push(row);
  }
  const labels = [...byLabel.keys()].sort((a, b) => {
    if (a === 'Uncategorized') return 1;
    if (b === 'Uncategorized') return -1;
    return a.localeCompare(b);
  });
  return labels.map((label) => ({ key: label, heading: label, entries: byLabel.get(label) }));
}

/** One collapsible group section (Label or Year mode). */
function renderGroupSection(group, mode) {
  const details = document.createElement('details');
  details.open = true;
  details.className = 'group-details';

  const summary = document.createElement('summary');
  summary.className =
    'flex cursor-pointer select-none items-center gap-1.5 px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-ink-muted hover:text-ink';
  const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  chevron.setAttribute('class', 'group-chevron icon !h-3 !w-3 transition-transform');
  chevron.setAttribute('viewBox', '0 0 24 24');
  chevron.setAttribute('fill', 'none');
  chevron.setAttribute('stroke', 'currentColor');
  chevron.setAttribute('stroke-linecap', 'round');
  chevron.setAttribute('stroke-linejoin', 'round');
  chevron.setAttribute('aria-hidden', 'true');
  const chevronPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  chevronPath.setAttribute('d', 'm9 18 6-6-6-6');
  chevron.appendChild(chevronPath);
  const headingEl = document.createElement('span');
  headingEl.className = 'truncate';
  headingEl.textContent = group.heading;
  const count = document.createElement('span');
  count.className = 'ml-auto text-[10px] font-normal normal-case text-ink-muted/70';
  count.textContent = String(group.entries.length);
  summary.append(chevron, headingEl, count);
  details.appendChild(summary);

  const body = document.createElement('div');
  body.className = 'flex flex-col gap-0.5 pb-1';

  if (mode === 'label') {
    // Sub-labels nest under their Label rather than becoming their own
    // top-level group (a flat "group by sub-label" would wrongly collide
    // sub-labels that share a name across different Labels).
    const noSub = group.entries.filter((r) => !r.sublabel);
    const bySub = new Map();
    for (const row of group.entries) {
      if (!row.sublabel) continue;
      if (!bySub.has(row.sublabel)) bySub.set(row.sublabel, []);
      bySub.get(row.sublabel).push(row);
    }
    for (const row of noSub) body.appendChild(renderEntryRow(row));
    for (const [sublabel, rows] of [...bySub.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const subHead = document.createElement('div');
      subHead.className = 'mt-1 truncate px-2 text-[10px] font-medium uppercase tracking-wide text-ink-muted/70';
      subHead.textContent = sublabel;
      body.appendChild(subHead);
      for (const row of rows) body.appendChild(renderEntryRow(row));
    }
  } else {
    for (const row of group.entries) body.appendChild(renderEntryRow(row));
  }

  details.appendChild(body);
  return details;
}

function renderEmptyState(message, action) {
  const empty = document.createElement('div');
  empty.className = 'flex flex-col items-start gap-2 px-3 py-6 text-xs text-ink-muted';
  const msg = document.createElement('span');
  msg.textContent = message;
  empty.appendChild(msg);
  if (action) {
    const btn = document.createElement('button');
    btn.className = 'btn text-xs';
    btn.textContent = action.label;
    btn.addEventListener('click', action.onClick);
    empty.appendChild(btn);
  }
  el.list.appendChild(empty);
}

function refreshLabelOptionsAndFieldSuggestions() {
  const labels = new Set(state.list.map((r) => r.label));
  el.labelOptions.textContent = '';
  for (const l of [...labels].sort()) {
    const opt = document.createElement('option');
    opt.value = l;
    el.labelOptions.appendChild(opt);
  }
  refreshFieldNameSuggestions();
}

function renderList() {
  el.list.textContent = '';

  if (state.list.length === 0) {
    renderEmptyState(
      el.search.value.trim()
        ? `No entries match “${el.search.value.trim()}”.`
        : 'No entries yet — create your first one.',
      el.search.value.trim()
        ? { label: 'Clear search', onClick: () => { el.search.value = ''; loadList(); } }
        : null
    );
    renderTagPills();
    refreshLabelOptionsAndFieldSuggestions();
    return;
  }

  const filtered =
    state.activeTags.size === 0
      ? state.list
      : state.list.filter((row) => row.tags.some((t) => state.activeTags.has(t.toLowerCase())));

  if (filtered.length === 0) {
    renderEmptyState(`No entries match the selected tag${state.activeTags.size > 1 ? 's' : ''}.`, {
      label: 'Clear tag filter',
      onClick: () => {
        state.activeTags.clear();
        saveSidebarPrefs();
        renderList();
      },
    });
    renderTagPills();
    refreshLabelOptionsAndFieldSuggestions();
    return;
  }

  const groups = groupEntries(filtered, state.groupMode);
  if (state.groupMode === 'flat') {
    for (const row of groups[0].entries) el.list.appendChild(renderEntryRow(row));
  } else {
    for (const group of groups) el.list.appendChild(renderGroupSection(group, state.groupMode));
  }

  renderTagPills();
  refreshLabelOptionsAndFieldSuggestions();
}

/** Top-6-by-usage tag filter pills; hidden entirely when nothing has tags. */
function renderTagPills() {
  const counts = new Map(); // lowercase -> { display, count }
  for (const row of state.list) {
    for (const t of row.tags) {
      const key = t.toLowerCase();
      const entry = counts.get(key) || { display: t, count: 0 };
      entry.count++;
      counts.set(key, entry);
    }
  }
  // Drop active filters for tags that no longer exist anywhere.
  for (const key of [...state.activeTags]) if (!counts.has(key)) state.activeTags.delete(key);

  el.tagPills.textContent = '';
  if (counts.size === 0) {
    el.tagPills.classList.add('hidden');
    el.tagPills.classList.remove('flex');
    return;
  }
  el.tagPills.classList.remove('hidden');
  el.tagPills.classList.add('flex');

  const TOP_N = 6;
  const byFrequency = [...counts.entries()].sort((a, b) => b[1].count - a[1].count);
  const topKeys = new Set(byFrequency.slice(0, TOP_N).map(([k]) => k));
  // Never silently drop a filter the user already has active, even if it
  // falls outside the visible top-N once other tags overtake it.
  for (const key of state.activeTags) if (counts.has(key)) topKeys.add(key);

  const visible = [...topKeys]
    .map((k) => [k, counts.get(k)])
    .sort((a, b) => a[1].display.localeCompare(b[1].display));

  const all = document.createElement('button');
  all.className = 'pill';
  all.textContent = 'All';
  all.setAttribute('aria-pressed', String(state.activeTags.size === 0));
  all.addEventListener('click', () => {
    state.activeTags.clear();
    saveSidebarPrefs();
    renderList();
  });
  el.tagPills.appendChild(all);

  for (const [key, { display }] of visible) {
    const pill = document.createElement('button');
    pill.className = 'pill';
    pill.textContent = display;
    pill.setAttribute('aria-pressed', String(state.activeTags.has(key)));
    pill.addEventListener('click', () => {
      state.activeTags.has(key) ? state.activeTags.delete(key) : state.activeTags.add(key);
      saveSidebarPrefs();
      renderList();
    });
    el.tagPills.appendChild(pill);
  }
}

/* ── sidebar organization prefs (group mode, tag filter, hidden state) ── */

function loadSidebarPrefs() {
  if (!state.lsAvailable) return;
  try {
    const mode = localStorage.getItem('bento.sidebarGroup');
    if (mode === 'label' || mode === 'year') state.groupMode = mode;
    const tagsRaw = localStorage.getItem('bento.sidebarTags');
    if (tagsRaw) {
      const arr = JSON.parse(tagsRaw);
      if (Array.isArray(arr)) state.activeTags = new Set(arr.filter((t) => typeof t === 'string'));
    }
  } catch (e) {
    // malformed prefs — ignore, defaults already set
  }
}

function saveSidebarPrefs() {
  if (!state.lsAvailable) return;
  try {
    localStorage.setItem('bento.sidebarGroup', state.groupMode);
    localStorage.setItem('bento.sidebarTags', JSON.stringify([...state.activeTags]));
  } catch (e) {
    // best-effort — not worth surfacing a toast for a preference write
  }
}

function syncGroupToggleUI() {
  for (const b of el.groupToggle.querySelectorAll('[data-group]')) {
    b.dataset.active = String(b.dataset.group === state.groupMode);
  }
}

/** Shared by boot (from localStorage) and the click handler. */
function applySidebarHidden(hidden) {
  el.sidebar.dataset.hidden = String(hidden);
  el.sidebarToggle.querySelector('.sidebar-icon-shown').classList.toggle('hidden', hidden);
  el.sidebarToggle.querySelector('.sidebar-icon-hidden').classList.toggle('hidden', !hidden);
  const label = hidden ? 'Show sidebar' : 'Hide sidebar';
  el.sidebarToggle.title = label;
  el.sidebarToggle.setAttribute('aria-label', label);
  el.sidebarToggle.setAttribute('aria-pressed', String(hidden));
}

/* ── open / new / close / delete ────────────────────────────── */

async function openEntry(id) {
  try {
    const { entry } = await api(`/api/entries/${id}`);
    state.current = entry;
    fillForm(entry);
    setDirty(false);
    clearBanner();
    setMode('read'); // open existing notes to read, not edit
    renderList();
  } catch (e) {
    if (e.code === 'NOT_FOUND') {
      toast('That entry no longer exists', 'err');
      await loadList();
    } else {
      toast(e.message, 'err');
    }
  }
}

function newEntry() {
  state.current = null;
  fillForm({});
  setDirty(false);
  clearBanner();
  setMode('edit'); // a fresh note starts in the editor
  renderList();
  el.title.focus();
}

// Closing puts the workspace at rest rather than dropping the user into a
// blank form they never asked for. The form is still reset behind the face
// card, so the next "New Entry" starts clean.
function closeEntry() {
  state.current = null;
  fillForm({});
  setDirty(false);
  clearBanner();
  dismissMetaSheet();
  setMode('empty');
  renderList(); // no row is active any more
}

/** Unsaved-changes guard: Save / Discard / Cancel — three explicit choices (§1.2). */
async function guardThen(fn) {
  if (!state.dirty) return fn();
  const choice = await confirmModal({
    title: 'Unsaved changes',
    body: 'This entry has edits that haven’t been saved.',
    actions: [
      { label: 'Save', value: 'save', style: 'primary' },
      { label: 'Discard changes', value: 'discard', style: 'danger' },
      { label: 'Cancel', value: 'cancel' },
    ],
  });
  if (choice === 'save') {
    const ok = await save();
    if (ok) return fn();
  } else if (choice === 'discard') {
    clearDraft();
    setDirty(false);
    return fn();
  }
}

/* ── save (guards, conflicts, 404) ──────────────────────────── */

async function save() {
  if (state.saving) return false;

  // Blank guard (§1.1): block, explain, focus the offending field
  const data = collectForm();
  if (!data.title.trim() || !data.body_md.trim()) {
    const missingTitle = !data.title.trim();
    await confirmModal({
      title: 'Entry needs a title and details',
      body: missingTitle
        ? 'Give the entry a title before saving.'
        : 'Write some details before saving.',
      actions: [{ label: 'Got it', value: 'ok', style: 'primary' }],
    });
    (missingTitle ? el.title : el.editor).focus();
    return false;
  }

  // Manually-edited modified time is sent as updated_at; otherwise omit it so
  // the server auto-bumps to now (and keeps full ms precision). The
  // concurrency token stays state.current.updated_at, read at full precision.
  const payload = { ...data };
  if (state.modifiedEdited) {
    const ms = parseLocalInputValue(el.modified.value);
    if (ms != null) payload.updated_at = ms;
  }

  state.saving = true;
  const spinnerTimer = setTimeout(() => {
    el.saveBtn.querySelector('.save-label').textContent = 'Saving…';
  }, 150);

  try {
    let resp;
    if (state.current) {
      resp = await api(`/api/entries/${state.current.id}`, {
        method: 'PUT',
        body: { ...payload, expected_updated_at: state.current.updated_at },
      });
    } else {
      resp = await api('/api/entries', { method: 'POST', body: payload });
    }
    state.current = resp.entry;
    setDirty(false);
    clearDraft();
    syncTimestampsFromCurrent();
    await loadList();
    emit('entry:saved', { id: resp.entry.id, updated_at: resp.entry.updated_at });
    flashSaved();
    return true;
  } catch (e) {
    if (e.status === 409) return handleConflict(e, data);
    if (e.code === 'NOT_FOUND') return handleDeletedElsewhere(data);
    if (e.code === 'NETWORK') {
      toast("Couldn't reach Bento host — your draft is safe locally", 'err', 6000);
      writeDraft(); // §3.5: dirty state + draft retained
      return false;
    }
    toast(e.message, 'err');
    return false;
  } finally {
    clearTimeout(spinnerTimer);
    state.saving = false;
  }
}

function flashSaved() {
  const label = el.saveBtn.querySelector('.save-label');
  label.textContent = '✓ Saved';
  announce('Entry saved');
  setTimeout(() => (label.textContent = 'Save Entry'), 1200);
}

/** 409: saved on another device (§3.3). Overwrite is never the default. */
async function handleConflict(err, data) {
  const server = err.payload?.entry;
  const choice = await confirmModal({
    title: 'Saved on another device',
    body: `This entry changed on the server at ${server ? formatStamp(server.updated_at) : 'an unknown time'}. Your version and theirs now differ.`,
    actions: [
      { label: 'Cancel', value: 'cancel', style: 'primary' },
      { label: 'Copy mine & load theirs', value: 'copyload' },
      { label: 'Overwrite theirs', value: 'overwrite', style: 'danger' },
    ],
  });
  if (choice === 'overwrite' && server) {
    state.current = server;
    return save();
  }
  if (choice === 'copyload' && server) {
    await copyText(data.body_md);
    toast('Your version copied to clipboard');
    state.current = server;
    fillForm(server);
    setDirty(false);
    clearDraft();
    renderList();
  }
  return false;
}

/** Entry deleted on another device while open here (§6.9). */
async function handleDeletedElsewhere(data) {
  const choice = await confirmModal({
    title: 'Entry was deleted elsewhere',
    body: 'This entry no longer exists on the server.',
    actions: [
      { label: 'Save as new entry', value: 'saveNew', style: 'primary' },
      { label: 'Discard', value: 'discard', style: 'danger' },
    ],
  });
  if (choice === 'saveNew') {
    state.current = null;
    return save();
  }
  if (choice === 'discard') {
    clearDraft();
    newEntry();
    await loadList();
  }
  return false;
}

async function deleteEntry() {
  if (!state.current) return;
  const choice = await confirmModal({
    title: 'Delete this entry?',
    body: `“${state.current.title}” will be permanently deleted.`,
    actions: [
      { label: 'Cancel', value: 'cancel', style: 'primary' },
      { label: 'Delete', value: 'delete', style: 'danger' },
    ],
  });
  if (choice !== 'delete') return;
  try {
    await api(`/api/entries/${state.current.id}`, { method: 'DELETE' });
    toast('Entry deleted', 'ok');
    clearDraft();
    setDirty(false);
    newEntry();
    await loadList();
  } catch (e) {
    toast(e.message, 'err');
  }
}

/* ── autosave drafts (§2) ───────────────────────────────────── */

function probeLocalStorage() {
  try {
    localStorage.setItem('bento.probe', '1');
    localStorage.removeItem('bento.probe');
    return true;
  } catch (e) {
    return false;
  }
}

function writeDraft() {
  if (!state.lsAvailable) return;
  try {
    // Snapshot the raw Modified field + its edit flag alongside the form so
    // a restored draft keeps a hand-edited modified time.
    const data = { ...collectForm(), _modified: el.modified.value, _modifiedEdited: state.modifiedEdited };
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ v: 1, entryId: state.current?.id ?? null, savedAt: Date.now(), data })
    );
  } catch (e) {
    if (!state.quotaWarned) {
      state.quotaWarned = true;
      toast('Auto-backup paused — note too large for browser storage', 'err', 6000);
    }
  }
}

function readDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    if (draft?.v !== 1 || !draft.data) return clearDraft(), null; // §2.8: unknown format → discard
    return draft;
  } catch (e) {
    return null;
  }
}

function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch (e) { /* nothing to clear */ }
}

async function offerDraftRestore() {
  const draft = readDraft();
  if (!draft) return false;

  let server = null;
  if (draft.entryId) {
    try {
      server = (await api(`/api/entries/${draft.entryId}`)).entry;
    } catch (e) { /* deleted since — treat as new-entry draft */ }
  }

  const serverNewer = server && server.updated_at > draft.savedAt;
  const choice = await confirmModal({
    title: 'Restore unsaved draft?',
    body: serverNewer
      ? `A draft from ${formatStamp(draft.savedAt)} was found, but this entry was saved more recently (${formatStamp(server.updated_at)}) — possibly on another device.`
      : `An unsaved draft from ${formatStamp(draft.savedAt)} was found${draft.entryId ? '' : ' for a new entry'}.`,
    actions: serverNewer
      ? [
          { label: 'Keep newer version', value: 'server', style: 'primary' },
          { label: 'Restore draft anyway', value: 'restore' },
        ]
      : [
          { label: 'Restore draft', value: 'restore', style: 'primary' },
          { label: 'Discard draft', value: 'discard', style: 'danger' },
        ],
  });

  if (choice === 'restore') {
    state.current = server;
    fillForm(draft.data);
    setDirty(true);
    setMode('edit'); // restored unsaved edits → drop into the editor
    clearDraft(); // will be re-written by the next autosave tick
    return true;
  }
  clearDraft(); // §2.4: declined → never re-prompt
  if (server) {
    state.current = server;
    fillForm(server);
    setDirty(false);
    setMode('read');
    return true;
  }
  return false;
}

/* ── focus sync across devices (§3.1–3.2) ───────────────────── */

async function onWindowFocus() {
  if (Date.now() - state.lastFocusSync < 30000) return;
  state.lastFocusSync = Date.now();
  try {
    if (!state.dirty) {
      await loadList();
      if (state.current) {
        const { entry } = await api(`/api/entries/${state.current.id}`).catch(() => ({ entry: null }));
        if (entry && entry.updated_at !== state.current.updated_at) {
          state.current = entry;
          fillForm(entry);
          toast('Entry refreshed from another device');
        }
      }
    } else {
      // Never clobber a dirty editor — metadata-only compare + banner
      const data = await api('/api/entries');
      state.list = data.entries;
      renderList();
      const row = state.current && state.list.find((r) => r.id === state.current.id);
      if (row && row.updated_at > state.current.updated_at) {
        showBanner({
          id: 'newer-version',
          message: 'This entry was updated on another device.',
          actions: [
            {
              label: 'Review',
              onClick: async (dismiss) => {
                dismiss();
                const fresh = (await api(`/api/entries/${state.current.id}`)).entry;
                await handleConflict({ payload: { entry: fresh } }, collectForm());
              },
            },
            { label: 'Keep mine', onClick: (dismiss) => dismiss() },
          ],
        });
      }
    }
  } catch (e) { /* offline — the health indicator covers this */ }
}

/* ── import (§7) ────────────────────────────────────────────── */

async function importFile(file) {
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    await confirmModal({
      title: 'File too large',
      body: 'Markdown imports are limited to 2 MB.',
      actions: [{ label: 'Got it', value: 'ok', style: 'primary' }],
    });
    return;
  }
  const content = await file.text();
  try {
    const { entry } = await api('/api/import', {
      method: 'POST',
      body: { filename: file.name, content },
    });
    toast(`Imported “${entry.title}”`, 'ok');
    state.current = entry;
    fillForm(entry);
    setDirty(false);
    setMode('read'); // review the imported note; toggle to edit if needed
    await loadList();
  } catch (e) {
    await confirmModal({
      title: 'Import failed',
      body: e.message,
      actions: [{ label: 'Got it', value: 'ok', style: 'primary' }],
    });
  }
}

/* ── layout: divider drag, narrow toggle, drawer ────────────── */

function initSplitDivider() {
  let dragging = false;
  el.divider.addEventListener('mousedown', (e) => {
    dragging = true;
    e.preventDefault();
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const split = document.getElementById('lb-split').getBoundingClientRect();
    const pct = Math.min(80, Math.max(20, ((e.clientX - split.left) / split.width) * 100));
    el.editorPane.style.flexBasis = pct + '%';
    el.editorPane.style.flexGrow = '0';
    el.previewPane.style.flexGrow = '1';
  });
  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
  el.divider.addEventListener('dblclick', () => {
    el.editorPane.style.flexBasis = '';
    el.editorPane.style.flexGrow = '';
    el.previewPane.style.flexGrow = '';
  });
}

function initNarrowToggle() {
  el.viewToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pane]');
    if (!btn) return;
    const pane = btn.dataset.pane;
    for (const b of el.viewToggle.querySelectorAll('[data-pane]')) {
      b.dataset.active = String(b === btn);
    }
    el.editorPane.classList.toggle('max-lg:hidden', pane !== 'editor');
    el.previewPane.classList.toggle('max-lg:hidden', pane !== 'preview');
    if (pane === 'preview') schedulePreview(0);
  });
}

/* ── metadata panel: collapsible column, sheet on a phone ────
   The panel is `w-72 flex-none`. Shown in flow on a phone that is 288 of
   ~390 available pixels, which squeezed the workspace until the entry
   header wrapped into a column of buttons — so below lg it is promoted to
   an overlay sheet instead (EDGE-CASES §8.5). Between lg and xl there is
   room for the column, and that behaviour is unchanged.

   #lb-meta-toggle drives all three forms from one control, sitting next to
   the Reading/Editor toggle as the right-edge mirror of the sidebar's
   Hide/Show. Two sources decide whether the panel is open:
     • the viewport — xl and up has room for a third column, below it does not;
     • the user's own click, remembered in `bento.metaHidden`.
   The click wins wherever it exists, so a panel closed on a desktop stays
   closed; with no stored preference the viewport keeps deciding, and
   widening a tablet into desktop territory still reveals the column. */
function initMetaPanel() {
  const asSheet = window.matchMedia('(max-width: 1023px)');
  const asColumn = window.matchMedia('(min-width: 1280px)');
  let scrim = null;
  // null = never toggled, so the viewport default still applies.
  let pref = null;
  if (state.lsAvailable) {
    try {
      const stored = localStorage.getItem('bento.metaHidden');
      if (stored === 'true' || stored === 'false') pref = stored !== 'true';
    } catch (e) {
      // ignore — the viewport default is a fine fallback
    }
  }

  function apply(open) {
    const sheet = open && asSheet.matches;

    el.metaPanel.dataset.hidden = String(!open);
    if (sheet) el.metaPanel.dataset.drawer = 'open';
    else delete el.metaPanel.dataset.drawer;

    if (sheet && !scrim) {
      scrim = document.createElement('div');
      scrim.className = 'scrim';
      scrim.addEventListener('click', () => setOpen(false));
      document.body.appendChild(scrim);
    } else if (!sheet && scrim) {
      scrim.remove();
      scrim = null;
    }

    el.metaToggle.querySelector('.meta-icon-shown').classList.toggle('hidden', !open);
    el.metaToggle.querySelector('.meta-icon-hidden').classList.toggle('hidden', open);
    const label = open ? 'Hide metadata' : 'Show metadata';
    el.metaToggle.title = label;
    el.metaToggle.setAttribute('aria-label', label);
    el.metaToggle.setAttribute('aria-pressed', String(open));
  }

  const isOpen = () => el.metaPanel.dataset.hidden !== 'true';

  function setOpen(open) {
    const wasSheet = !!scrim;
    apply(open);
    // Move focus with the surface: into the sheet on open (its own close
    // button, not the first input — a phone keyboard flying up unasked is
    // worse than one extra tap), back to the toggle when it closes.
    if (open && scrim) el.metaClose.focus();
    else if (!open && wasSheet) el.metaToggle.focus();
  }

  /** A deliberate toggle — records the preference the viewport then defers to. */
  function choose(open) {
    pref = open;
    setOpen(open);
    if (state.lsAvailable) {
      try {
        localStorage.setItem('bento.metaHidden', String(!open));
      } catch (e) {
        // best-effort — not worth surfacing a toast for a preference write
      }
    }
  }

  // Closing an entry hides the whole panel from CSS; the sheet's scrim lives
  // on <body> and would outlive it, so give closeEntry a way to dismiss it.
  dismissMetaSheet = () => {
    if (scrim) setOpen(false);
  };

  // Only the toggle records a preference. Dismissing the sheet — its ✕, the
  // scrim, Escape, a swipe — means "not right now", not "never on any
  // screen"; making it sticky would boot the desktop column closed because
  // of a tap on a phone.
  el.metaToggle.addEventListener('click', () => choose(!isOpen()));
  el.metaClose.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && scrim) setOpen(false);
  });

  // Rotating a phone into landscape can cross the lg line: re-resolve the
  // open panel into whichever form fits. Shrinking *into* phone territory
  // would turn a column the user never asked to overlay into a scrim-backed
  // sheet, so that direction closes it instead of promoting it.
  asSheet.addEventListener('change', (e) => {
    if (!isOpen()) return;
    if (e.matches) setOpen(false);
    else apply(true);
  });

  // Crossing xl only re-resolves while the user has expressed no preference.
  asColumn.addEventListener('change', (e) => {
    if (pref === null) setOpen(e.matches);
  });

  // Boot: a remembered "open" must not throw a scrim-backed sheet over the
  // app on a phone before the user has asked for anything, so sheet widths
  // always start closed.
  apply(!asSheet.matches && (pref === null ? asColumn.matches : pref));

  // Swipe the sheet away — the entries drawer's gesture, mirrored.
  let startX = null;
  let startY = null;
  el.metaPanel.addEventListener('touchstart', (e) => {
    if (!scrim || e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });
  el.metaPanel.addEventListener('touchend', (e) => {
    if (startX === null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    startX = null;
    startY = null;
    if (dx > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) setOpen(false);
  }, { passive: true });
}

function initDrawer() {
  let scrim = null;
  // The overlay surface lives in CSS (#lb-sidebar[data-drawer="open"]), not in
  // utility classes: bg-panel-2/50 from the desktop column outranks a bg-panel
  // utility on source order, which left the drawer see-through.
  const open = () => {
    el.sidebar.classList.remove('max-lg:hidden');
    el.sidebar.dataset.drawer = 'open';
    scrim = document.createElement('div');
    scrim.className = 'scrim';
    scrim.addEventListener('click', close);
    document.body.appendChild(scrim);
    el.search.focus();
  };
  const close = () => {
    if (!scrim) return;
    el.sidebar.classList.add('max-lg:hidden');
    delete el.sidebar.dataset.drawer;
    scrim.remove();
    scrim = null;
    el.drawerOpen.focus();
  };
  el.drawerOpen.addEventListener('click', open);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && scrim) close();
  });
  // Selecting an entry on mobile closes the drawer
  el.list.addEventListener('click', () => close());

  // Swipe the drawer away — the gesture that opened it, reversed.
  let startX = null;
  let startY = null;
  el.sidebar.addEventListener('touchstart', (e) => {
    if (!scrim || e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });
  el.sidebar.addEventListener('touchend', (e) => {
    if (startX === null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    startX = null;
    startY = null;
    if (dx < -60 && Math.abs(dx) > Math.abs(dy) * 1.5) close();
  }, { passive: true });
}

/* ── init ───────────────────────────────────────────────────── */

export async function initLogbook() {
  initRibbon();
  initSplitDivider();
  initNarrowToggle();
  initDrawer();

  state.lsAvailable = probeLocalStorage();
  if (!state.lsAvailable) toast('Browser storage unavailable — autosave is off this session', 'err', 6000);

  loadSidebarPrefs();
  syncGroupToggleUI();
  if (state.lsAvailable) {
    try {
      if (localStorage.getItem('bento.sidebarHidden') === 'true') applySidebarHidden(true);
    } catch (e) {
      // ignore — sidebar just stays visible
    }
  }

  // Editing marks dirty; editor input also reschedules the preview
  el.editor.addEventListener('input', () => {
    setDirty(true);
    schedulePreview();
  });
  for (const input of [el.title, el.summary, el.label, el.sublabel, el.tags, el.urls]) {
    input.addEventListener('input', () => {
      setDirty(true);
      syncMetaWidgets();
    });
  }

  // Editing the Modified time marks it a manual override (sent verbatim on
  // save instead of auto-bumping to now).
  el.modified.addEventListener('input', () => {
    state.modifiedEdited = true;
    setDirty(true);
  });

  // Dynamic metadata fields: add via button or Enter from either input
  el.fieldAddBtn.addEventListener('click', addField);
  for (const input of [el.fieldAddName, el.fieldAddValue]) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addField();
      }
    });
    input.addEventListener('input', () => fieldError(''));
  }

  let searchTimer = null;
  el.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadList().catch(() => {}), 200);
  });

  el.newBtn.addEventListener('click', () => guardThen(newEntry));
  el.closeBtn.addEventListener('click', () => guardThen(closeEntry));
  el.emptyNewBtn.addEventListener('click', () => newEntry());
  el.saveBtn.addEventListener('click', save);
  el.deleteBtn.addEventListener('click', deleteEntry);

  el.importBtn.addEventListener('click', () => guardThen(() => el.fileInput.click())); // §7.7
  el.fileInput.addEventListener('change', () => {
    importFile(el.fileInput.files[0]);
    el.fileInput.value = '';
  });

  el.guideBtn.addEventListener('click', async () => {
    const dlg = document.getElementById('dlg-guide');
    await renderInto(document.getElementById('guide-body'), GUIDE_MD);
    dlg.showModal();
  });

  initMetaPanel();

  // Reading / Editor mode toggle
  el.modeToggle.addEventListener('click', () => {
    const toEdit = el.workspace.dataset.mode !== 'edit';
    setMode(toEdit ? 'edit' : 'read');
    if (toEdit) el.editor.focus();
  });

  // Sidebar organization: Group by Flat/Label/Year
  el.groupToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-group]');
    if (!btn || btn.dataset.group === state.groupMode) return;
    state.groupMode = btn.dataset.group;
    syncGroupToggleUI();
    saveSidebarPrefs();
    renderList();
  });

  // Sidebar Hide/Show — independent of Focus Mode
  el.sidebarToggle.addEventListener('click', () => {
    const hidden = el.sidebar.dataset.hidden !== 'true';
    applySidebarHidden(hidden);
    if (state.lsAvailable) {
      try {
        localStorage.setItem('bento.sidebarHidden', String(hidden));
      } catch (e) {
        // best-effort
      }
    }
  });

  // ⌘S / Ctrl+S saves while the LogBook is visible (§ ribbon tooltips)
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      // Nothing to save with no entry open — let the browser keep the key
      if (el.workspace.dataset.mode === 'empty') return;
      if (!document.getElementById('view-logbook').hidden) {
        e.preventDefault();
        save();
      }
    }
  });

  window.addEventListener('focus', onWindowFocus);
  setInterval(() => {
    if (state.dirty) writeDraft(); // §2.1: skip the write when clean
  }, 10000);

  on('theme:changed', () => schedulePreview(0)); // mermaid re-themes

  // Boot: list, then draft restore, else open the most recent entry
  try {
    await loadList();
    const restored = await offerDraftRestore();
    if (!restored) {
      if (state.list.length > 0) await openEntry(state.list[0].id);
      else newEntry();
    }
  } catch (e) {
    toast("Couldn't reach the Bento host — check that the server is running", 'err', 8000);
  }
}

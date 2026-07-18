// Skills tab — curated catalog of agent skills (vercel-labs/skills
// ecosystem): search, category pills, SKILL.md preview (Rendered ↔ Raw),
// download, install command, and "update available" alerts. Read-mostly:
// the catalog is admin-curated shared content, not something users author.

import { api } from './api.js';
import { toast } from './ui.js';
import { copyText } from './clipboard.js';
import { renderInto } from './render.js';

const el = {
  search: document.getElementById('sk-search'),
  pills: document.getElementById('sk-pills'),
  groups: document.getElementById('sk-groups'),
  refreshBtn: document.getElementById('sk-refresh'),
  guideBody: document.getElementById('sk-guide-body'),
  dlg: document.getElementById('dlg-skill'),
  dlgTitle: document.getElementById('dlg-skill-title'),
  dlgMeta: document.getElementById('dlg-skill-meta'),
  dlgBanner: document.getElementById('dlg-skill-banner'),
  dlgViewToggle: document.getElementById('dlg-skill-viewtoggle'),
  dlgRendered: document.getElementById('dlg-skill-rendered'),
  dlgRaw: document.getElementById('dlg-skill-raw'),
  dlgCopy: document.getElementById('dlg-skill-copy'),
  dlgDownload: document.getElementById('dlg-skill-download'),
  dlgInstallBtn: document.getElementById('dlg-skill-install'),
};

const state = {
  skills: [],
  activeCategories: new Set(),
  current: null, // catalog row for the open dialog
  currentMd: '',
};

// What the ribbon's alert buttons insert (a4ec912) — used verbatim in the
// setup guide below so its own preview exercises the same renderer path.
const SETUP_GUIDE_MD = `## What are agent skills?

An agent skill is a folder with a \`SKILL.md\` file (YAML frontmatter \`name\`
+ \`description\`) that teaches a coding agent — like Claude Code — a
repeatable procedure: how to build an MCP server, review a PR, fill in a
PDF form, and so on.

### Installing a skill

Run the install command shown on a skill's card (or copy it from the
detail view):

\`\`\`bash
npx skills add <owner>/<repo> --skill <name>
\`\`\`

This drops the skill folder into one of two conventional locations:

- \`.claude/skills/\` — Claude Code project or user skills
- \`.agents/skills/\` — cross-agent shared skills

### How Bento OS tracks installs

Bento OS never runs the install command for you — "Mark as installed"
simply records the skill's current upstream version (a GitHub tree SHA) for
your account. If that folder changes upstream later, the card shows an
**Update available** chip so you know to re-run the install command.`;

/* ── data ───────────────────────────────────────────────────── */

async function load() {
  const data = await api('/api/skills');
  state.skills = data.skills;
  render();
}

function visibleSkills() {
  const term = el.search.value.trim().toLowerCase();
  return state.skills.filter((s) => {
    if (state.activeCategories.size && !state.activeCategories.has(s.category)) return false;
    if (!term) return true;
    const haystack = `${s.name} ${s.description} ${(s.tags || []).join(' ')}`.toLowerCase();
    return haystack.includes(term);
  });
}

/* ── rendering ──────────────────────────────────────────────── */

function render() {
  renderPills();
  renderGroups();
}

function renderPills() {
  const categories = new Set(state.skills.map((s) => s.category));
  // Drop active categories that no longer exist
  for (const c of [...state.activeCategories]) if (!categories.has(c)) state.activeCategories.delete(c);

  el.pills.textContent = '';
  if (categories.size === 0) return;

  const all = document.createElement('button');
  all.className = 'pill';
  all.textContent = 'All';
  all.setAttribute('aria-pressed', String(state.activeCategories.size === 0));
  all.addEventListener('click', () => {
    state.activeCategories.clear();
    render();
  });
  el.pills.appendChild(all);

  for (const category of [...categories].sort()) {
    const pill = document.createElement('button');
    pill.className = 'pill';
    pill.textContent = category;
    pill.setAttribute('aria-pressed', String(state.activeCategories.has(category)));
    pill.addEventListener('click', () => {
      state.activeCategories.has(category) ? state.activeCategories.delete(category) : state.activeCategories.add(category);
      render();
    });
    el.pills.appendChild(pill);
  }
}

function renderGroups() {
  el.groups.textContent = '';
  const visible = visibleSkills();

  if (visible.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'flex flex-col items-center gap-3 py-16 text-center text-sm text-ink-muted';
    const msg = document.createElement('p');
    msg.textContent = el.search.value.trim()
      ? `Nothing matches “${el.search.value.trim()}”.`
      : 'Nothing matches the selected categories.';
    empty.appendChild(msg);
    const clear = document.createElement('button');
    clear.className = 'btn';
    clear.textContent = 'Clear filters';
    clear.addEventListener('click', () => {
      el.search.value = '';
      state.activeCategories.clear();
      render();
    });
    empty.appendChild(clear);
    el.groups.appendChild(empty);
    return;
  }

  const byCategory = new Map();
  for (const s of visible) {
    if (!byCategory.has(s.category)) byCategory.set(s.category, []);
    byCategory.get(s.category).push(s);
  }

  for (const [category, skills] of [...byCategory.entries()].sort()) {
    const section = document.createElement('section');
    section.className = 'pt-8 first:pt-4';
    const h = document.createElement('h2');
    h.className = 'mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-ink-muted';
    h.textContent = category;
    section.appendChild(h);
    for (const s of skills) section.appendChild(renderCard(s));
    el.groups.appendChild(section);
  }
}

function renderCard(s) {
  const card = document.createElement('article');
  card.className = 'mb-3 flex flex-col gap-2 rounded-card border border-edge bg-panel p-4 shadow-card';

  const title = document.createElement('h3');
  title.className = 'text-base font-bold';
  title.textContent = s.name;
  card.appendChild(title);

  const chips = document.createElement('div');
  chips.className = 'flex flex-wrap gap-1';
  const repoChip = document.createElement('span');
  repoChip.className = 'tag-chip';
  repoChip.textContent = `${s.owner}/${s.repo}`;
  chips.appendChild(repoChip);
  if (s.installed) {
    const installedChip = document.createElement('span');
    installedChip.className = 'tag-chip text-ok-hue';
    installedChip.textContent = 'Installed ✓';
    chips.appendChild(installedChip);
  }
  if (s.update_available) {
    const updateChip = document.createElement('span');
    updateChip.className = 'tag-chip text-warn-hue';
    updateChip.textContent = 'Update available';
    chips.appendChild(updateChip);
  }
  card.appendChild(chips);

  const desc = document.createElement('p');
  desc.className = 'text-sm text-ink-muted';
  desc.textContent = s.description;
  card.appendChild(desc);

  const actions = document.createElement('div');
  actions.className = 'flex flex-wrap items-center gap-1.5';
  const openBtn = document.createElement('button');
  openBtn.className = 'btn btn-primary text-xs';
  openBtn.textContent = 'View SKILL.md';
  openBtn.addEventListener('click', () => openDetail(s));
  actions.appendChild(openBtn);
  card.appendChild(actions);

  return card;
}

/* ── detail dialog ──────────────────────────────────────────── */

function setSkillView(view) {
  const rendered = view === 'rendered';
  el.dlgViewToggle.querySelector('[data-view="rendered"]').dataset.active = String(rendered);
  el.dlgViewToggle.querySelector('[data-view="raw"]').dataset.active = String(!rendered);
  el.dlgRendered.classList.toggle('hidden', !rendered);
  el.dlgRaw.classList.toggle('hidden', rendered);
}

function updateDetailButtons(s) {
  el.dlgInstallBtn.textContent = s.installed ? 'Remove' : 'Mark installed';
  el.dlgInstallBtn.classList.toggle('btn-danger', !!s.installed);
  el.dlgInstallBtn.classList.toggle('btn-primary', !s.installed);
}

async function openDetail(s) {
  state.current = s;
  state.currentMd = '';
  el.dlgTitle.textContent = s.name;
  el.dlgMeta.textContent = `${s.owner}/${s.repo} · ${s.skill_path}`;
  el.dlgBanner.classList.add('hidden');
  el.dlgRendered.textContent = 'Loading…';
  el.dlgRaw.textContent = '';
  setSkillView('rendered');
  updateDetailButtons(s);
  el.dlg.showModal();

  try {
    const { skill_md, upstream_sha } = await api(`/api/skills/${s.id}`);
    state.currentMd = skill_md;
    s.upstream_sha = upstream_sha;
    s.update_available = !!(s.installed && upstream_sha && s.installed_sha !== upstream_sha);
    await renderInto(el.dlgRendered, skill_md);
    el.dlgRaw.textContent = skill_md;
    if (s.update_available) {
      el.dlgBanner.textContent = 'A newer version of this skill is available upstream — re-run the install command to update.';
      el.dlgBanner.classList.remove('hidden');
    }
  } catch (e) {
    el.dlgRendered.textContent = '';
    toast(e.message || "Couldn't load SKILL.md", 'err');
  }
}

async function toggleInstalled() {
  const s = state.current;
  if (!s) return;
  try {
    if (s.installed) {
      await api(`/api/skills/${s.id}/install`, { method: 'DELETE' });
      s.installed = false;
      s.installed_sha = null;
      toast(`${s.name} marked as not installed`);
    } else {
      await api(`/api/skills/${s.id}/install`, { method: 'POST', body: { sha: s.upstream_sha ?? null } });
      s.installed = true;
      s.installed_sha = s.upstream_sha ?? null;
      toast(`${s.name} marked as installed`);
    }
    s.update_available = !!(s.installed && s.upstream_sha && s.installed_sha !== s.upstream_sha);
    updateDetailButtons(s);
    render();
  } catch (e) {
    toast(e.message, 'err');
  }
}

function downloadSkillMd() {
  const s = state.current;
  if (!s) return;
  const blob = new Blob([state.currentMd || ''], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'SKILL.md';
  a.click();
  URL.revokeObjectURL(url);
}

async function copyInstallCommand() {
  const s = state.current;
  if (!s) return;
  const ok = await copyText(s.install_command);
  if (ok) toast('Install command copied');
}

async function checkForUpdates() {
  const ids = state.skills.filter((s) => s.installed).map((s) => s.id);
  if (ids.length === 0) return toast('No installed skills to check');
  try {
    await api('/api/skills/refresh', { method: 'POST', body: { ids } });
    await load();
    const updates = state.skills.filter((s) => s.update_available).length;
    toast(updates ? `${updates} update${updates === 1 ? '' : 's'} available` : 'Everything is up to date');
  } catch (e) {
    toast(e.message, 'err');
  }
}

/* ── init ───────────────────────────────────────────────────── */

export async function initSkills() {
  renderInto(el.guideBody, SETUP_GUIDE_MD).catch(() => {});

  let searchTimer = null;
  el.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(render, 200);
  });
  el.refreshBtn.addEventListener('click', checkForUpdates);

  el.dlgViewToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-view]');
    if (btn) setSkillView(btn.dataset.view);
  });
  el.dlgCopy.addEventListener('click', copyInstallCommand);
  el.dlgDownload.addEventListener('click', downloadSkillMd);
  el.dlgInstallBtn.addEventListener('click', toggleInstalled);

  try {
    await load();
  } catch (e) {
    toast("Couldn't load the skills catalog", 'err');
  }
}

// App shell: boot health check, theme, tab router, traffic lights,
// status dock, focus mode (UX-SPEC §2).

import { api } from './api.js';
import { emit, on } from './bus.js';
import { toast, announce } from './ui.js';
import { setMermaidTheme } from './render.js';
import { initAuth } from './auth.js';
import { initLogbook } from './logbook.js';
import { initPrompts } from './prompts.js';
import { initSnippets } from './snippets.js';
import { initFaceCard } from './face-card.js';

const frame = document.getElementById('frame');
const TOOLS = {
  logbook: { tab: document.getElementById('tab-logbook'), view: document.getElementById('view-logbook'), name: 'Docs LogBook' },
  prompts: { tab: document.getElementById('tab-prompts'), view: document.getElementById('view-prompts'), name: 'Prompt Library' },
  snippets: { tab: document.getElementById('tab-snippets'), view: document.getElementById('view-snippets'), name: 'Code Snippets' },
};

/* ── theme (dark-first; UX-SPEC §1) ─────────────────────────── */

function applyTheme(dark) {
  document.documentElement.classList.toggle('dark', dark);
  setMermaidTheme(dark);
  emit('theme:changed', { dark });
}

function initTheme() {
  const stored = localStorage.getItem('bento.theme');
  const dark = stored ? stored === 'dark' : true; // dark is the design target
  applyTheme(dark);
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const nowDark = !document.documentElement.classList.contains('dark');
    localStorage.setItem('bento.theme', nowDark ? 'dark' : 'light');
    applyTheme(nowDark);
  });
}

/* ── tabs (roving tablist; tabs hide, never unmount — §1.4) ─── */

let activeTool = 'logbook';
const minimized = new Set();

function activateTab(id) {
  if (minimized.has(id)) restoreFromDock(id);
  activeTool = id;
  for (const [key, t] of Object.entries(TOOLS)) {
    const active = key === id && !minimized.has(key);
    t.tab.setAttribute('aria-selected', String(key === id));
    t.tab.dataset.active = String(key === id);
    t.view.hidden = !active;
    t.view.classList.toggle('hidden', !active);
    t.view.classList.toggle('flex', active && key === 'logbook');
  }
  emit('tab:activate', { tabId: id });
}

function initTabs() {
  const tabs = Object.values(TOOLS).map((t) => t.tab);
  for (const [id, tool] of Object.entries(TOOLS)) {
    tool.tab.addEventListener('click', () => activateTab(id));
  }
  // Arrow-key navigation on the tablist (UX-SPEC §5)
  for (const tab of tabs) {
    tab.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const idx = tabs.indexOf(tab);
      const next = tabs[(idx + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      next.focus();
      next.click();
    });
  }
}

/* ── swipe between tools (touch) ─────────────────────────────
   On a phone the tablist is the only way across tools, and reaching for it
   breaks the flow of reading. A horizontal swipe moves to the neighbouring
   tool, matching what every tabbed mobile app does.

   The guards matter more than the gesture: a swipe that starts inside
   something the user can actually scroll sideways (a wide code block, a
   Mermaid diagram, a table) belongs to that element, and a swipe inside a
   text field belongs to the caret. */

const SWIPE_MIN_PX = 60;      // shorter than this is a tap or a jitter
const SWIPE_H_RATIO = 1.5;    // must be clearly horizontal, not a diagonal scroll

function startsInScrollableX(node) {
  for (let el = node; el && el !== document.body; el = el.parentElement) {
    if (!(el instanceof Element)) continue;
    const style = getComputedStyle(el);
    const scrollable = /(auto|scroll)/.test(style.overflowX);
    if (scrollable && el.scrollWidth > el.clientWidth + 1) return true;
  }
  return false;
}

function initSwipeNav() {
  const main = document.querySelector('main');
  if (!main) return;
  let startX = null;
  let startY = null;
  let armed = false;

  main.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return; // pinch/zoom is not a swipe
    const target = e.target;
    armed = !(
      document.querySelector('dialog[open]') ||
      document.querySelector('#lb-sidebar[data-drawer="open"]') ||
      target.closest('input, textarea, select, [contenteditable="true"]') ||
      startsInScrollableX(target)
    );
    if (!armed) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });

  main.addEventListener('touchend', (e) => {
    if (!armed || startX === null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    startX = null;
    startY = null;
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * SWIPE_H_RATIO) return;

    // Only tools still on screen participate; minimized ones live in the dock.
    const open = Object.keys(TOOLS).filter((k) => !minimized.has(k));
    const idx = open.indexOf(activeTool);
    if (idx === -1) return;
    const next = open[idx + (dx < 0 ? 1 : -1)];
    if (!next) return; // no wrap-around: the ends should feel like ends
    activateTab(next);
    announce(`${TOOLS[next].name}`);
  }, { passive: true });
}

/* ── traffic lights ─────────────────────────────────────────── */

const dock = document.getElementById('dock');

function minimizeToDock(id) {
  if (minimized.has(id)) return;
  minimized.add(id);
  const tool = TOOLS[id];
  tool.view.hidden = true;
  tool.view.classList.add('hidden');
  tool.view.classList.remove('flex');

  const pill = document.createElement('button');
  pill.className = 'dock-pill';
  pill.dataset.tool = id;
  pill.textContent = tool.name;
  pill.setAttribute('aria-label', `Restore ${tool.name}`);
  const dot = document.createElement('span');
  dot.className = 'ml-1 hidden h-1.5 w-1.5 rounded-full bg-warn-hue';
  dot.dataset.dirtyDot = id;
  pill.appendChild(dot);
  pill.addEventListener('click', () => {
    restoreFromDock(id);
    activateTab(id);
  });
  dock.appendChild(pill);

  // Land somewhere sensible: the other tool if it's open (macOS metaphor)
  const other = Object.keys(TOOLS).find((k) => k !== id && !minimized.has(k));
  if (other) activateTab(other);
  announce(`${tool.name} minimized to dock`);
}

function restoreFromDock(id) {
  minimized.delete(id);
  dock.querySelector(`[data-tool="${id}"]`)?.remove();
  announce(`${TOOLS[id].name} restored`);
}

function initTrafficLights() {
  // 🔴 minimize active tool to the dock
  document.getElementById('tl-red').addEventListener('click', () => minimizeToDock(activeTool));

  // 🟡 Focus Mode: collapse sidebars + metadata (shortcut ⌘. / Ctrl+.)
  const yellow = document.getElementById('tl-yellow');
  const toggleFocus = () => {
    const onNow = frame.dataset.focusmode !== 'true';
    frame.dataset.focusmode = String(onNow);
    yellow.setAttribute('aria-pressed', String(onNow));
    announce(onNow ? 'Focus mode on' : 'Focus mode off');
  };
  yellow.addEventListener('click', toggleFocus);
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === '.') {
      e.preventDefault();
      toggleFocus();
    }
  });

  // 🟢 fullscreen — resync on any fullscreenchange, incl. Esc (§8.2)
  const green = document.getElementById('tl-green');
  green.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (e) {
      toast('Fullscreen is not supported here');
    }
  });
  document.addEventListener('fullscreenchange', () => {
    green.setAttribute('aria-pressed', String(!!document.fullscreenElement));
  });
  if (!document.documentElement.requestFullscreen) {
    green.addEventListener('click', () => toast('Fullscreen is not supported here'), { once: false });
  }
}

/* ── dirty dot on tab + dock pill ───────────────────────────── */

on('entry:dirty', ({ isDirty }) => {
  document.getElementById('dirty-dot').classList.toggle('hidden', !isDirty);
  const dockDot = dock.querySelector('[data-dirty-dot="logbook"]');
  dockDot?.classList.toggle('hidden', !isDirty);
});

/* ── health check + offline indicator (§3.6/§3.7) ───────────── */

async function healthCheck() {
  const conn = document.getElementById('conn-status');
  try {
    const { schema } = await api('/api/health');
    conn.classList.add('hidden');
    conn.classList.remove('flex');
    const known = localStorage.getItem('bento.schema');
    if (known && Number(known) !== schema) {
      localStorage.setItem('bento.schema', String(schema));
      toast('Bento OS was updated — reloading', 'info', 2000);
      setTimeout(() => location.reload(), 1500);
      return;
    }
    localStorage.setItem('bento.schema', String(schema));
  } catch (e) {
    conn.classList.remove('hidden');
    conn.classList.add('flex');
  }
}

/* ── boot ───────────────────────────────────────────────────── */

initTheme(); // the login portal is themed too

// Auth gate: nothing below loads until the user is signed in and has cleared
// any forced password change. Every /api call then carries their session.
await initAuth();

initTabs();
initSwipeNav();
initTrafficLights();
activateTab('logbook'); // normal users land on their LogBook workspace
healthCheck();
setInterval(healthCheck, 60000);

initLogbook();
initPrompts();
initSnippets();
initFaceCard('pr-face-card');
initFaceCard('sn-face-card');

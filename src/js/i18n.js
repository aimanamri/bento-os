// Display language (UX-SPEC §1's sibling: the same shape as theme.js).
//
// One module owns the whole vocabulary. Static copy lives in index.html and is
// marked with data-i18n / data-i18n-attr; anything a module builds at runtime
// asks for it by key through t(). Switching locale re-walks the document and
// emits `locale:changed`, so the panes that render their own DOM redraw
// themselves rather than the app reloading — a reload would throw away an
// unsaved draft, which the rest of the app works hard never to do.
//
// With no stored choice the app follows the browser (`navigator.languages`)
// and keeps following it until the user picks a side, at which point their
// choice sticks — the same bargain theme.js strikes with prefers-color-scheme.

import { emit } from './bus.js';
import en from './locales/en.js';
import ja from './locales/ja.js';
import ms from './locales/ms.js';

const CATALOGS = { en, ja, ms };
const FALLBACK = 'en';
const STORAGE_KEY = 'bento.locale';

/** Order here is the order the switcher lists them in. */
export const LOCALES = [
  { code: 'en', label: 'English', short: 'EN', tag: 'en', manifest: '/manifest.webmanifest' },
  { code: 'ja', label: '日本語', short: 'JA', tag: 'ja-JP', manifest: '/manifest.ja.webmanifest' },
  { code: 'ms', label: 'Bahasa Melayu', short: 'MS', tag: 'ms', manifest: '/manifest.ms.webmanifest' },
];

let current = FALLBACK;

function storedChoice() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return CATALOGS[v] ? v : null;
  } catch {
    return null; // private mode, or storage disabled — fall back to the browser
  }
}

/** First browser preference we actually ship a catalogue for. */
function browserChoice() {
  for (const tag of navigator.languages || [navigator.language || '']) {
    const base = String(tag).toLowerCase().split('-')[0];
    if (CATALOGS[base]) return base;
  }
  return FALLBACK;
}

export function getLocale() {
  return current;
}

/**
 * BCP-47 tag for the Intl APIs. English resolves to `undefined` on purpose:
 * that is "use the browser's own formatting", which is what every date in the
 * app did before this module existed.
 */
export function localeTag() {
  return current === FALLBACK ? undefined : LOCALES.find((l) => l.code === current)?.tag;
}

/**
 * Look a phrase up. Catalogue values are either strings or, where a phrase has
 * to bend around a number or a name, functions of the vars object — which is
 * also how the two languages disagree about plurals without either of them
 * carrying the other's grammar.
 */
export function t(key, vars) {
  const entry = CATALOGS[current]?.[key] ?? CATALOGS[FALLBACK][key];
  if (entry === undefined) return key; // visible, greppable, never blank
  return typeof entry === 'function' ? entry(vars || {}) : entry;
}

/**
 * Re-fill every marked node under `root`.
 *
 * Only textContent and attributes are ever written — no innerHTML — so the
 * catalogue can never introduce markup, and this module stays outside the
 * sanitizer's problem (SECURITY.md §2).
 */
export function applyTranslations(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const el of root.querySelectorAll('[data-i18n-attr]')) {
    // "placeholder:lb.searchPlaceholder; aria-label:lb.searchLabel"
    for (const pair of el.dataset.i18nAttr.split(';')) {
      const idx = pair.indexOf(':');
      if (idx === -1) continue;
      const attr = pair.slice(0, idx).trim();
      const key = pair.slice(idx + 1).trim();
      if (attr && key) el.setAttribute(attr, t(key));
    }
  }
}

/**
 * Everything that has to change outside the catalogue lookup itself.
 *
 * The manifest swap is the odd one out: an installed app's name and its
 * long-press shortcuts are OS chrome, read once at install time, so they can
 * never follow a live toggle. Repointing the link means the *next* install —
 * and any browser that re-reads it — picks up the right language.
 */
function applyLocaleToDocument(code) {
  const loc = LOCALES.find((l) => l.code === code);
  document.documentElement.lang = loc?.tag || code;
  const link = document.querySelector('link[rel="manifest"]');
  if (link && loc?.manifest) link.setAttribute('href', loc.manifest);
  applyTranslations();
}

export function setLocale(code, { persist = true } = {}) {
  if (!CATALOGS[code] || code === current) return;
  current = code;
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, code);
    } catch {
      /* the switch still holds for this session */
    }
  }
  applyLocaleToDocument(code);
  emit('locale:changed', { locale: code });
}


/**
 * Wire every [data-lang-switch] cluster on the page — the title bar's inside
 * the app and the lock screen's outside it, the same two-places problem
 * theme.js solves the same way, because the window frame is hidden until you
 * sign in.
 *
 * Rows are generated from LOCALES rather than written into index.html, so a
 * new language is a catalogue plus one line in that array. Language names are
 * always shown in their own language (English, 日本語) — a reader looking for
 * their language should not have to already be reading yours to find it.
 */
function initLangSwitchers() {
  for (const wrap of document.querySelectorAll('[data-lang-switch]')) {
    const btn = wrap.querySelector('[data-lang-toggle]');
    const menu = wrap.querySelector('[data-lang-menu]');
    if (!btn || !menu) continue;

    const paint = () => {
      menu.textContent = '';
      for (const loc of LOCALES) {
        const row = document.createElement('button');
        row.type = 'button';
        row.setAttribute('role', 'menuitemradio');
        row.setAttribute('aria-checked', String(loc.code === current));
        row.className =
          'flex w-full items-center justify-between gap-2 rounded-md px-3 py-1.5 text-left text-xs hover:bg-panel-2 cursor-pointer';
        row.lang = loc.tag; // so the row itself renders in the right font
        const name = document.createElement('span');
        name.textContent = loc.label;
        const tick = document.createElement('span');
        tick.className = 'text-accent';
        tick.textContent = loc.code === current ? '✓' : '';
        row.append(name, tick);
        row.addEventListener('click', () => {
          close();
          setLocale(loc.code);
          btn.focus();
        });
        menu.appendChild(row);
      }
    };

    function open() {
      paint();
      menu.classList.remove('hidden');
      btn.setAttribute('aria-expanded', 'true');
      menu.querySelector('[role=menuitemradio]')?.focus();
    }
    function close() {
      menu.classList.add('hidden');
      btn.setAttribute('aria-expanded', 'false');
    }

    btn.addEventListener('click', () => {
      menu.classList.contains('hidden') ? open() : close();
    });
    menu.addEventListener('keydown', (e) => {
      const items = [...menu.querySelectorAll('[role=menuitemradio]')];
      const idx = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); items[(idx + 1) % items.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); items[(idx - 1 + items.length) % items.length].focus(); }
      else if (e.key === 'Escape') { close(); btn.focus(); }
    });
    document.addEventListener('click', (e) => {
      if (!menu.classList.contains('hidden') && !wrap.contains(e.target)) close();
    });

    paint();
  }
}

/**
 * Runs before any module renders, so the first paint is already in the right
 * language — no flash of English on a Japanese browser.
 */
export function initI18n() {
  current = storedChoice() || browserChoice();
  applyLocaleToDocument(current);
  initLangSwitchers();
}

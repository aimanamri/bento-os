// The render pipeline — the ONLY place user markdown becomes DOM
// (SECURITY.md §2). Order matters: markdown-it → KaTeX → Mermaid →
// DOMPurify LAST, then the caller mounts the sanitized string.

/* global markdownit, DOMPurify, katex, renderMathInElement, mermaid */

const md = markdownit({
  html: false, // raw HTML in markdown is escaped, never passed through
  linkify: true,
  breaks: false,
});

// Superscript / subscript support via <sup>/<sub> HTML tags. We deliberately
// do NOT use the `^text^` / `~text~` markdown extensions: `^` is how KaTeX
// writes exponents inside $…$, and `~text~` would collide with `~~strike~~`.
// This inline rule whitelists exactly those four tags (open/close, no
// attributes) and passes them through as html_inline tokens; everything else
// stays escaped by html:false, and DOMPurify (which allows sub/sup) is still
// the final guard.
md.inline.ruler.push('sup_sub_html', (state, silent) => {
  if (state.src.charCodeAt(state.pos) !== 0x3c /* < */) return false;
  const m = /^<\/?(?:sup|sub)>/i.exec(state.src.slice(state.pos, state.pos + 6));
  if (!m) return false;
  if (!silent) {
    const token = state.push('html_inline', '', 0);
    token.content = m[0];
  }
  state.pos += m[0].length;
  return true;
});

const PURIFY_CONFIG = {
  // KaTeX needs MathML spans, Mermaid needs SVG (+ its scoped <style>).
  USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
  // 'input' is not in the html profile; the hook below constrains any that
  // appear to disabled checkboxes (task lists) — everything else is removed.
  ADD_TAGS: ['semantics', 'annotation', 'input'],
  // 'id' carries the heading slugs that in-document anchors jump to.
  ADD_ATTR: ['aria-hidden', 'data-line', 'type', 'checked', 'disabled', 'id'],
  // foreignObject is the classic SVG sanitizer bypass — strict-mode Mermaid
  // doesn't emit it; we enforce what the renderer promises.
  FORBID_TAGS: ['foreignObject', 'form', 'iframe', 'object', 'embed', 'base', 'link', 'meta', 'script'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'formaction'],
  // DOMPurify's *default* URI regex already rejects javascript:/data:/vbscript:
  // (anything not matching a known scheme or a schemeless value) — see
  // https://github.com/cure53/DOMPurify. A narrower custom regex here once
  // required attribute values to literally start with "https?:"/"mailto:",
  // which made DOMPurify treat plain geometry attributes like SVG's
  // `viewBox`/`width="100%"` as failed URIs and strip them — silently
  // blanking every Mermaid diagram. Rely on the vetted default instead.
};

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.hasAttribute('href')) {
    if (node.getAttribute('href').startsWith('#')) {
      // In-document jump (a table of contents, a "see below" link): stays in
      // this tab and never touches location.hash — the click handler below
      // scrolls the surface itself. target/rel are cleared so a stale
      // attribute from earlier markup can't reopen it in a new tab.
      node.setAttribute('class', `${node.getAttribute('class') || ''} md-anchor`.trim());
      node.removeAttribute('target');
      node.removeAttribute('rel');
    } else {
      // Notes link out to the web: no reverse-tabnabbing.
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  }
  // Task-list checkboxes are display-only (EDGE-CASES §4.9); any other
  // input type that survives is removed outright.
  if (node.tagName === 'INPUT') {
    if (node.getAttribute('type') === 'checkbox') node.setAttribute('disabled', '');
    else node.remove();
  }
});

let mermaidReady = false;
function initMermaid(dark) {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict', // encodes labels, disables click bindings
    theme: dark ? 'dark' : 'default',
    fontFamily: 'ui-monospace, Menlo, monospace',
  });
  mermaidReady = true;
}
export function setMermaidTheme(dark) {
  initMermaid(dark);
}

// Localized failure chip — built with textContent so the error text
// (which echoes user input) cannot inject (EDGE-CASES §4.1–4.2).
function errorChip(label, source, detail) {
  const box = document.createElement('div');
  box.className = 'render-error';
  const head = document.createElement('span');
  head.className = 'render-error-label';
  head.textContent = `⚠ ${label}`;
  box.appendChild(head);
  if (detail) {
    const msg = document.createElement('div');
    msg.textContent = String(detail).split('\n')[0].slice(0, 200);
    msg.className = 'mb-1 opacity-80';
    box.appendChild(msg);
  }
  const pre = document.createElement('pre');
  pre.textContent = source;
  box.appendChild(pre);
  return box;
}

// "- [ ] task" / "- [x] done" → display-only checkboxes
function transformTaskLists(host) {
  for (const li of host.querySelectorAll('li')) {
    const first = li.firstChild;
    if (!first || first.nodeType !== Node.TEXT_NODE) continue;
    const m = first.nodeValue.match(/^\[([ xX])\]\s+/);
    if (!m) continue;
    first.nodeValue = first.nodeValue.slice(m[0].length);
    const cb = document.createElement('input');
    cb.setAttribute('type', 'checkbox');
    cb.setAttribute('disabled', '');
    // attribute, not property — properties don't survive innerHTML serialization
    if (m[1] !== ' ') cb.setAttribute('checked', '');
    li.style.listStyle = 'none';
    li.insertBefore(cb, li.firstChild);
  }
}

// Legacy markers (pre-GFM): blockquote starting with an emoji gets a
// colored border only, no header — kept so notes written before the GFM
// alert syntax landed still render the way they did when saved.
const LEGACY_ALERT_KINDS = [
  ['✅', 'alert-success'],
  ['ℹ️', 'alert-info'],
  ['⚠️', 'alert-warning'],
];

// GitHub-Flavored Markdown alerts: a blockquote whose first line is
// `[!NOTE]` / `[!TIP]` / `[!IMPORTANT]` / `[!WARNING]` / `[!CAUTION]`
// becomes a colored, icon-labeled callout — the ribbon inserts this syntax.
const GFM_ALERT_KINDS = {
  NOTE: { cls: 'alert-note', icon: 'ℹ️', label: 'Note' },
  TIP: { cls: 'alert-tip', icon: '💡', label: 'Tip' },
  IMPORTANT: { cls: 'alert-important', icon: '❗', label: 'Important' },
  WARNING: { cls: 'alert-warning', icon: '⚠️', label: 'Warning' },
  CAUTION: { cls: 'alert-caution', icon: '🛑', label: 'Caution' },
};
const GFM_MARKER_RE = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\n?/;

function transformAlerts(host) {
  for (const bq of host.querySelectorAll('blockquote')) {
    const firstBlock = bq.querySelector('p') || bq;
    const m = GFM_MARKER_RE.exec(firstBlock.textContent || '');
    if (m) {
      const kind = GFM_ALERT_KINDS[m[1]];
      bq.classList.add('alert', kind.cls);
      // Strip the "[!TYPE]" marker text out of the first text node so it
      // isn't shown twice alongside the header we render in its place.
      const walker = document.createTreeWalker(firstBlock, NodeFilter.SHOW_TEXT);
      const node = walker.nextNode();
      if (node) node.nodeValue = node.nodeValue.replace(GFM_MARKER_RE, '');
      const header = document.createElement('div');
      header.className = 'alert-title';
      header.textContent = `${kind.icon} ${kind.label}`;
      bq.insertBefore(header, bq.firstChild);
      continue;
    }
    const text = bq.textContent.trimStart();
    for (const [marker, cls] of LEGACY_ALERT_KINDS) {
      if (text.startsWith(marker)) {
        bq.classList.add('alert', cls);
        break;
      }
    }
  }
}

// Mermaid v11's default renderer puts every node/edge/cluster label inside
// a <foreignObject><div>…<span class="nodeLabel">… — even under
// securityLevel:'strict' and flowchart.htmlLabels:false (that stopped
// working in newer Mermaid; the renderer always uses foreignObject now).
// DOMPurify correctly empties foreignObject content wholesale rather than
// trying to sanitize inside it, so allow-listing the tag just makes every
// label vanish. Instead, pull each label's plain text out ourselves — via
// .textContent only, which can carry no markup — into a real SVG <text>
// node, then drop the foreignObject. foreignObject stays globally forbidden
// in PURIFY_CONFIG; this transform is the only path label text takes out of
// it, and that path is provably inert.
function collapseForeignObjectLabels(root) {
  for (const fo of root.querySelectorAll('foreignObject')) {
    const width = parseFloat(fo.getAttribute('width')) || 0;
    const height = parseFloat(fo.getAttribute('height')) || 0;
    // Belt-and-suspenders: if a script/style tag ever reached this far
    // (Mermaid's own internal sanitizer already strips these), drop it
    // before reading textContent so its source can't surface as label text.
    fo.querySelectorAll('script, style').forEach((n) => n.remove());
    const text = (fo.textContent || '').replace(/\s+/g, ' ').trim();
    if (text) {
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('x', String(width / 2));
      t.setAttribute('y', String(height / 2));
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('dominant-baseline', 'central');
      t.setAttribute('class', 'nodeLabel');
      t.textContent = text;
      fo.replaceWith(t);
    } else {
      fo.remove(); // empty layout-only foreignObject (e.g. unused edge label slot)
    }
  }
}

/* ── in-document anchors (heading links) ────────────────────── */

// GitHub-style slug: lowercase, punctuation/emoji dropped, spaces → hyphens.
// `[Setup](#setup-steps)` and `[Setup](#Setup Steps)` both resolve to the
// heading "## Setup Steps".
function slugify(text) {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

// markdown-it emits bare <h1>…<h6>; without ids there is nothing for a
// `#section` link to land on. Duplicate headings get -1, -2, … like GitHub.
function assignHeadingIds(host) {
  const seen = new Map();
  for (const h of host.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    const base = slugify(h.textContent) || 'section';
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    h.setAttribute('id', n === 0 ? base : `${base}-${n}`);
  }
}

// The rendered surface scrolls, not the window — find the pane that actually
// owns the overflow so we scroll that one and leave the page put.
function scrollParent(node) {
  let p = node.parentElement;
  while (p && p !== document.body) {
    const overflowY = getComputedStyle(p).overflowY;
    if (/(auto|scroll|overlay)/.test(overflowY) && p.scrollHeight > p.clientHeight) return p;
    p = p.parentElement;
  }
  return null;
}

function findAnchorTarget(host, hash) {
  let raw = hash;
  try { raw = decodeURIComponent(hash); } catch { /* malformed %-escape: use as typed */ }
  // Matched by walking [id] rather than a selector — slugs come from user
  // headings and would need escaping to be safe inside one.
  for (const node of host.querySelectorAll('[id]')) {
    if (node.id === raw) return node;
  }
  // Fall back to slug matching so links written with the heading's literal
  // text (spaces, caps, punctuation) still find their section.
  const wanted = slugify(raw);
  if (!wanted) return null;
  for (const h of host.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    if (h.id === wanted || slugify(h.textContent) === wanted) return h;
  }
  return null;
}

// One delegated listener for every markdown surface (preview lane, reading
// mode, the guide dialog). preventDefault is unconditional for `#…` links:
// a missing target must not fall through to the browser and rewrite the URL.
document.addEventListener('click', (e) => {
  const a = e.target.closest?.('a.md-anchor[href^="#"]');
  if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
  e.preventDefault();

  const host = a.closest('.md-preview') || a.getRootNode();
  const target = findAnchorTarget(host, a.getAttribute('href').slice(1));
  if (!target) return;

  const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  const pane = scrollParent(target);
  if (pane) {
    const top = target.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop;
    pane.scrollTo({ top: Math.max(0, top - 12), behavior });
  } else {
    target.scrollIntoView({ behavior, block: 'start' });
  }

  // Brief tint so the eye catches where it landed (the URL gives no clue).
  target.classList.remove('anchor-flash');
  void target.offsetWidth; // restart the animation on repeat clicks
  target.classList.add('anchor-flash');
  setTimeout(() => target.classList.remove('anchor-flash'), 1200);
});

let seq = 0;

/**
 * Render markdown to a sanitized HTML string. Async because Mermaid is.
 * Per-block try/catch: one bad formula or diagram never takes down the lane.
 */
export async function renderMarkdown(source) {
  const host = document.createElement('div');
  host.innerHTML = md.render(source); // html:false ⇒ markdown-generated markup only

  transformTaskLists(host);
  transformAlerts(host);
  assignHeadingIds(host);

  // KaTeX — auto-render skips code/pre so `$x$` in code spans stays literal
  // (EDGE-CASES §4.10). throwOnError:false renders the bad TeX inline in the
  // error color; trust:false + maxExpand cap per SECURITY.md §2.
  try {
    renderMathInElement(host, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '$', right: '$', display: false },
      ],
      ignoredTags: ['pre', 'code', 'script', 'style', 'textarea', 'option'],
      throwOnError: false,
      errorColor: 'rgb(240 98 93)',
      trust: false,
      maxExpand: 1000,
      strict: 'ignore',
    });
  } catch (e) {
    // auto-render itself failing is non-fatal; math just stays as text
  }

  if (!mermaidReady) initMermaid(document.documentElement.classList.contains('dark'));
  const fences = [...host.querySelectorAll('pre > code.language-mermaid')];
  for (const code of fences) {
    const src = code.textContent;
    const pre = code.parentElement;
    if (!src.trim()) {
      pre.remove(); // empty fence: render nothing, no error chip (§4.8)
      continue;
    }
    const id = `mmd-${Date.now()}-${seq++}`;
    try {
      const { svg } = await mermaid.render(id, src);
      const wrap = document.createElement('div');
      wrap.className = 'mermaid-block';
      wrap.innerHTML = svg;
      collapseForeignObjectLabels(wrap);
      pre.replaceWith(wrap);
    } catch (e) {
      pre.replaceWith(errorChip('Mermaid error', src, e && e.message));
    } finally {
      // strict mode can leave a temp error element in the body — suppress it
      document.getElementById('d' + id)?.remove();
      document.getElementById(id)?.remove();
    }
  }

  return DOMPurify.sanitize(host.innerHTML, PURIFY_CONFIG);
}

/** Render into a target element (the single mount point per surface). */
export async function renderInto(el, source) {
  el.innerHTML = await renderMarkdown(source);
}

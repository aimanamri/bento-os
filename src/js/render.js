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
  ADD_ATTR: ['aria-hidden', 'data-line', 'type', 'checked', 'disabled'],
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
  // Notes link out to the web: no reverse-tabnabbing.
  if (node.tagName === 'A' && node.hasAttribute('href')) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
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

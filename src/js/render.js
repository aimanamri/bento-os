// The render pipeline — the ONLY place user markdown becomes DOM
// (SECURITY.md §2). Order matters: markdown-it → KaTeX → Mermaid →
// DOMPurify LAST, then the caller mounts the sanitized string.

/* global markdownit, DOMPurify, katex, renderMathInElement, mermaid */

import { copyText } from './clipboard.js';
import { announce } from './ui.js';

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

/* ── YAML frontmatter → key/value table ─────────────────────── */

// A `---` fence on the very first line, closed by `---` or `...`. Anything
// else — no fence, or one that never closes — falls through to markdown-it,
// which keeps rendering a leading `---` as the horizontal rule it always was.
function splitFrontmatter(source) {
  const lines = source.split('\n').map((l) => l.replace(/\r$/, ''));
  if (!/^---[ \t]*$/.test(lines[0] || '')) return null;
  for (let i = 1; i < lines.length; i++) {
    if (/^(?:---|\.\.\.)[ \t]*$/.test(lines[i])) {
      return { yaml: lines.slice(1, i), body: lines.slice(i + 1).join('\n') };
    }
  }
  return null;
}

// A deliberately small YAML subset — the shapes note frontmatter actually
// uses: scalars, nested maps, sequences, block scalars and inline flow
// collections. Whatever it can't read stays the literal text it was written
// as, so a table always renders instead of an error.

const indentOf = (line) => line.length - line.trimStart().length;

function skipFiller(s) {
  while (s.i < s.lines.length && (!s.lines[s.i].trim() || /^\s*#/.test(s.lines[s.i]))) s.i++;
}

// `#` opens a comment only at a word boundary and only outside quotes, so
// `color: "#fff"` and `id: a#b` keep their values.
function stripComment(text) {
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (quote === '"' && c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '#' && (i === 0 || /\s/.test(text[i - 1]))) return text.slice(0, i);
  }
  return text;
}

// `key: value`, `"quoted key": value`, or a bare `key:` whose value is the
// block below it. A colon needs trailing space to open a mapping, so
// `url: https://x` keeps its whole value and `10:30` stays a scalar.
const MAP_ENTRY_RE = /^(?:"((?:[^"\\]|\\.)*)"|'((?:[^']|'')*)'|([^:#]+?))\s*:(?:\s+([\s\S]*))?$/;

function matchEntry(text) {
  const m = MAP_ENTRY_RE.exec(text);
  if (!m) return null;
  let key;
  if (m[1] !== undefined) key = unquote(`"${m[1]}"`);
  else if (m[2] !== undefined) key = m[2].replace(/''/g, "'");
  else key = m[3].trim();
  return { key, value: (m[4] || '').trim() };
}

function unquote(v) {
  if (/^"(?:[^"\\]|\\.)*"$/.test(v)) {
    return v.slice(1, -1).replace(/\\(.)/g, (_, c) => ({ n: '\n', r: '\r', t: '\t' }[c] || c));
  }
  if (/^'(?:[^']|'')*'$/.test(v)) return v.slice(1, -1).replace(/''/g, "'");
  return v;
}

// `complete` is false when the parser stopped early — a line it doesn't
// understand (an anchor, a `!!tag`, a second document). The caller shows the
// raw block in that case rather than a table that quietly drops the rest.
function parseYaml(lines) {
  const s = { lines: lines.slice(), i: 0 };
  skipFiller(s);
  if (s.i >= s.lines.length) return { data: new Map(), complete: true };
  const data = parseBlock(s, indentOf(s.lines[s.i]));
  skipFiller(s);
  return { data, complete: s.i >= s.lines.length };
}

function parseBlock(s, indent) {
  return /^-(\s|$)/.test(s.lines[s.i].trim()) ? parseSeq(s, indent) : parseMap(s, indent);
}

function parseMap(s, indent) {
  const map = new Map(); // ordered, and unbothered by keys like __proto__
  for (;;) {
    skipFiller(s);
    const line = s.lines[s.i];
    if (line === undefined || indentOf(line) !== indent) break;
    const entry = matchEntry(stripComment(line).trim());
    if (!entry) break;
    s.i++;
    map.set(entry.key, parseValue(s, indent, entry.value));
  }
  return map;
}

function parseSeq(s, indent) {
  const items = [];
  for (;;) {
    skipFiller(s);
    const line = s.lines[s.i];
    if (line === undefined || indentOf(line) !== indent) break;
    const m = /^-(?:\s+([\s\S]*))?$/.exec(stripComment(line).trim());
    if (!m) break;
    const rest = (m[1] || '').trim();
    if (!rest) {
      s.i++;
      items.push(parseNested(s, indent));
    } else if (matchEntry(rest)) {
      // `- key: value`: the item is a map whose first key sits just past the
      // dash and whose sibling keys line up under it. Rewriting the dash away
      // — on our own copy of the lines — lets parseMap read them in one pass.
      const col = line.indexOf(rest);
      s.lines[s.i] = ' '.repeat(col) + rest;
      items.push(parseMap(s, col));
    } else {
      s.i++;
      items.push(parseScalar(rest));
    }
  }
  return items;
}

function parseValue(s, indent, raw) {
  // Block scalar. The chomping/indent indicators are consumed but ignored —
  // in a table cell only the text itself shows.
  const block = /^([|>])[+-]?\d*$/.exec(raw);
  if (block) return parseBlockScalar(s, indent, block[1]);
  return raw ? parseScalar(raw) : parseNested(s, indent);
}

function parseNested(s, indent) {
  skipFiller(s);
  const line = s.lines[s.i];
  if (line === undefined) return '';
  const childIndent = indentOf(line);
  if (childIndent > indent) return parseBlock(s, childIndent);
  // A sequence may sit in its parent key's own column: `tags:` then `- a`.
  if (childIndent === indent && /^-(\s|$)/.test(line.trim())) return parseSeq(s, indent);
  return '';
}

function parseBlockScalar(s, indent, style) {
  const collected = [];
  while (s.i < s.lines.length && (!s.lines[s.i].trim() || indentOf(s.lines[s.i]) > indent)) {
    collected.push(s.lines[s.i++]);
  }
  while (collected.length && !collected[collected.length - 1].trim()) collected.pop();
  if (!collected.length) return '';
  const base = Math.min(...collected.filter((l) => l.trim()).map(indentOf));
  const text = collected.map((l) => l.slice(base));
  if (style === '|') return text.join('\n');
  // Folded: newlines inside a paragraph become spaces, blank lines stay breaks.
  return text.reduce((out, line) => {
    if (!line.trim()) return `${out}\n`;
    return out && !out.endsWith('\n') ? `${out} ${line}` : out + line;
  }, '');
}

function parseScalar(v) {
  if (v.startsWith('[') || v.startsWith('{')) {
    const flow = parseFlow(v);
    if (flow !== null) return flow;
  }
  return unquote(v);
}

// `[a, b]` / `{k: v}` on one line. Returns null the moment the syntax stops
// making sense, so a half-parsed value never displaces the raw text.
function parseFlow(src) {
  let i = 0;
  const skipWs = () => { while (i < src.length && /\s/.test(src[i])) i++; };

  function readToken() {
    skipWs();
    const quote = src[i] === '"' || src[i] === "'" ? src[i] : null;
    const start = i;
    if (quote) {
      for (i++; i < src.length; i++) {
        if (quote === '"' && src[i] === '\\') i++;
        else if (src[i] === quote) { i++; break; }
      }
      return unquote(src.slice(start, i));
    }
    while (i < src.length && !/[,:\]}]/.test(src[i])) i++;
    return src.slice(start, i).trim();
  }

  function readCollection(close, onPair) {
    i++; // past the opening bracket
    for (;;) {
      skipWs();
      if (i >= src.length) return false;
      if (src[i] === close) { i++; return true; }
      if (!onPair()) return false;
      skipWs();
      if (src[i] === ',') i++;
      else if (src[i] !== close) return false;
    }
  }

  function readValue() {
    skipWs();
    if (src[i] === '[') {
      const items = [];
      return readCollection(']', () => {
        const v = readValue();
        if (v === null) return false;
        items.push(v);
        return true;
      }) ? items : null;
    }
    if (src[i] === '{') {
      const map = new Map();
      return readCollection('}', () => {
        const key = readToken();
        skipWs();
        if (src[i] !== ':') return false;
        i++;
        const v = readValue();
        if (v === null) return false;
        map.set(key, v);
        return true;
      }) ? map : null;
    }
    return readToken();
  }

  const out = readValue();
  skipWs();
  return i === src.length ? out : null;
}

const sizeOf = (node) => (node instanceof Map ? node.size : node.length);

// GitHub renders frontmatter as a two-column table — key on the left, value on
// the right — with nested maps and sequences as tables of their own.
function frontmatterTable(node) {
  const table = document.createElement('table');
  table.className = 'md-frontmatter';
  const tbody = document.createElement('tbody');
  const rows = node instanceof Map ? [...node] : node.map((v) => [null, v]);
  for (const [key, value] of rows) {
    const tr = document.createElement('tr');
    if (key !== null) {
      const th = document.createElement('th');
      th.setAttribute('scope', 'row');
      th.textContent = key;
      tr.appendChild(th);
    }
    const td = document.createElement('td');
    // Values are the literal text they were written as — no markdown, no math
    // (GitHub does the same), and textContent means they can carry no markup.
    if (value instanceof Map || Array.isArray(value)) {
      if (sizeOf(value)) td.appendChild(frontmatterTable(value));
    } else {
      td.textContent = String(value);
    }
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

// The table for a note's frontmatter — or a plain <pre> of the source when
// the block is something this parser can't read. The fence is stripped from
// the body either way, so anything it can't turn into rows still has to be
// shown; text the user typed never just disappears.
function frontmatterNode(yamlLines) {
  let parsed;
  try {
    parsed = parseYaml(yamlLines);
  } catch {
    parsed = { data: new Map(), complete: false };
  }
  if (parsed.complete && sizeOf(parsed.data)) return frontmatterTable(parsed.data);
  if (!yamlLines.some((l) => l.trim())) return null; // `---\n---`: nothing to show
  const pre = document.createElement('pre');
  pre.textContent = yamlLines.join('\n');
  return pre;
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
  const fm = splitFrontmatter(source);
  host.innerHTML = md.render(fm ? fm.body : source); // html:false ⇒ markdown-generated markup only

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

  // Prepended after the transforms above have run, so none of them reach into
  // it: a `$…$` in a field stays the text it was, and a `#` heading in
  // frontmatter doesn't become an anchor target.
  if (fm) {
    const table = frontmatterNode(fm.yaml);
    if (table) host.insertBefore(table, host.firstChild);
  }

  return DOMPurify.sanitize(host.innerHTML, PURIFY_CONFIG);
}

// Static markup, never user content — the only strings these two ever hold
// (SECURITY.md §2 allows innerHTML in render.js; this is not a note's markup).
const ICON_COPY =
  '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const ICON_DONE =
  '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M20 6 9 17l-5-5"/></svg>';

async function copyCodeBlock(btn, code) {
  if (btn.dataset.busy) return;
  btn.dataset.busy = '1';
  // copyText falls back to execCommand and then to a manual-copy modal, so a
  // false return means the user was already handed the text (EDGE-CASES §5.9).
  const ok = await copyText(code.textContent);
  delete btn.dataset.busy;
  if (!ok) return;

  btn.classList.add('is-copied');
  btn.innerHTML = ICON_DONE;
  btn.setAttribute('aria-label', 'Code copied');
  announce('Code copied');
  clearTimeout(Number(btn.dataset.resetTimer));
  btn.dataset.resetTimer = String(setTimeout(() => {
    btn.classList.remove('is-copied');
    btn.innerHTML = ICON_COPY;
    btn.setAttribute('aria-label', btn.dataset.copyLabel);
  }, 1500));
}

/**
 * Give every fenced code block a copy button.
 *
 * Runs on the mounted DOM *after* DOMPurify, and builds the button with DOM
 * APIs rather than markup: nothing in a note can forge one, and the sanitizer
 * never has to allow <button> (which would let a note ship its own).
 *
 * `pre > code` is what markdown-it emits for a fence. Mermaid fences are gone
 * by now (replaced by their diagram) and errorChip's <pre> holds no <code>,
 * so neither picks up a button.
 */
function addCopyButtons(root) {
  for (const code of root.querySelectorAll('pre > code')) {
    const pre = code.parentElement;
    const lang = [...code.classList].find((c) => c.startsWith('language-'))?.slice(9);
    const label = lang ? `Copy ${lang} code` : 'Copy code';

    const wrap = document.createElement('div');
    wrap.className = 'code-block';
    pre.replaceWith(wrap);
    wrap.appendChild(pre);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'code-copy';
    btn.title = label;
    btn.dataset.copyLabel = label;
    btn.setAttribute('aria-label', label);
    btn.innerHTML = ICON_COPY;
    btn.addEventListener('click', () => copyCodeBlock(btn, code));
    wrap.appendChild(btn);
  }
}

/** Render into a target element (the single mount point per surface). */
export async function renderInto(el, source) {
  el.innerHTML = await renderMarkdown(source);
  addCopyButtons(el);
}

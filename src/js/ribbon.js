// Sticky tool ribbon: cursor-aware injections (UX-SPEC §3) — wrap the
// selection when there is one, else insert boilerplate and place the caret
// inside the placeholder. Plus the 💡 bulb syntax-reference menu.

const editor = () => document.getElementById('lb-editor');

function fireInput(ta) {
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Wrap selection (or placeholder) with before/after; select the middle. */
export function wrapSelection(before, after, placeholder = 'text') {
  const ta = editor();
  const { selectionStart: s, selectionEnd: e, value } = ta;
  const middle = s === e ? placeholder : value.slice(s, e);
  ta.setRangeText(before + middle + after, s, e, 'select');
  ta.setSelectionRange(s + before.length, s + before.length + middle.length);
  ta.focus();
  fireInput(ta);
}

/** Prefix the current line (headings): replaces an existing #-prefix. */
function prefixLine(prefix) {
  const ta = editor();
  const { value, selectionStart: s } = ta;
  const lineStart = value.lastIndexOf('\n', s - 1) + 1;
  let lineEnd = value.indexOf('\n', lineStart);
  if (lineEnd === -1) lineEnd = value.length;
  const line = value.slice(lineStart, lineEnd).replace(/^#{1,6}\s+/, '');
  ta.setRangeText(prefix + line, lineStart, lineEnd, 'end');
  ta.focus();
  fireInput(ta);
}

/** Prefix each line in the selection (or the current line) with a marker. */
function prefixLines(makeMarker) {
  const ta = editor();
  const { value, selectionStart: s, selectionEnd: e } = ta;
  const lineStart = value.lastIndexOf('\n', s - 1) + 1;
  let lineEnd = value.indexOf('\n', e);
  if (lineEnd === -1) lineEnd = value.length;
  const out = value
    .slice(lineStart, lineEnd)
    .split('\n')
    .map((line, i) => makeMarker(i) + line)
    .join('\n');
  ta.setRangeText(out, lineStart, lineEnd, 'end');
  ta.focus();
  fireInput(ta);
}

/** Insert a block at the cursor, surrounded by blank lines; caret inside. */
function insertBlock(text, caretOffset = null) {
  const ta = editor();
  const { value, selectionStart: s } = ta;
  const needsNlBefore = s > 0 && value[s - 1] !== '\n' ? '\n\n' : s > 1 && value[s - 2] !== '\n' ? '\n' : '';
  const block = needsNlBefore + text + '\n';
  ta.setRangeText(block, s, ta.selectionEnd, 'end');
  if (caretOffset !== null) {
    const pos = s + needsNlBefore.length + caretOffset;
    ta.setSelectionRange(pos, pos);
  }
  ta.focus();
  fireInput(ta);
}

const TABLE_3X4 = [
  '| Column 1 | Column 2 | Column 3 |',
  '| --- | --- | --- |',
  '| … | … | … |',
  '| … | … | … |',
  '| … | … | … |',
  '| … | … | … |',
].join('\n');

// [aria-label, svg path d (string or string[]), action, kbd]
const BUTTONS = [
  ['Heading 1', 'M4 12h8M4 6v12M12 6v12M17 12l2-1v7', () => prefixLine('# ')],
  ['Heading 2', 'M4 12h8M4 6v12M12 6v12M17 10c0-1 1-2 2.5-2s2.5 1 2.5 2c0 2-5 3-5 6h5', () => prefixLine('## ')],
  ['Heading 3', 'M4 12h8M4 6v12M12 6v12M17.5 8h4l-2.5 4c1.5 0 3 1 3 3s-1.5 3-3 3-2.5-.7-3-2', () => prefixLine('### ')],
  null,
  ['Bold', 'M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z', () => wrapSelection('**', '**', 'bold'), 'b'],
  ['Italic', 'M19 4h-9M14 20H5M15 4 9 20', () => wrapSelection('*', '*', 'italic'), 'i'],
  ['Strikethrough', 'M4 12h16M17 6c-1-1.5-2.7-2-5-2-3 0-5 1.2-5 3.5 0 1 .4 1.8 1.2 2.5M8 18c1 1.4 2.6 2 5 2 3 0 5-1.4 5-3.5 0-.8-.3-1.6-.9-2.2', () => wrapSelection('~~', '~~', 'text')],
  ['Superscript', ['m4 19 8-8', 'm12 19-8-8', 'M20 12h-4c0-1.5.5-2 1.5-2.5S20 8.3 20 7c0-.5-.2-.9-.5-1.3a2.1 2.1 0 0 0-2.6-.4c-.4.2-.7.6-.9 1'], () => wrapSelection('<sup>', '</sup>', '2')],
  ['Subscript', ['m4 5 8 8', 'm12 5-8 8', 'M20 19h-4c0-1.5.5-2 1.5-2.5S20 15.3 20 14c0-.5-.2-.9-.5-1.3a2.1 2.1 0 0 0-2.6-.4c-.4.2-.7.6-.9 1'], () => wrapSelection('<sub>', '</sub>', '2')],
  ['Inline code', 'm10 8-4 4 4 4M14 8l4 4-4 4', () => wrapSelection('`', '`', 'code')],
  ['Link', 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7', () => wrapSelection('[', '](https://)', 'link text'), 'k'],
  null,
  ['Bulleted list', ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'], () => prefixLines(() => '- ')],
  ['Numbered list', ['M10 6h11', 'M10 12h11', 'M10 18h11', 'M4 6h1v4', 'M4 10h2', 'M6 18H4c0-1 2-2 2-3s-1-1.5-2-1'], () => prefixLines((i) => `${i + 1}. `)],
  ['Checkbox item', 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11', () => insertBlock('- [ ] task', 6)],
  ['Insert 3×4 table', 'M3 5h18v14H3zM3 10h18M3 15h18M9 5v14M15 5v14', () => insertBlock(TABLE_3X4)],
  null,
  ['Note alert block', 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01', () => insertBlock('> [!NOTE]\n> Useful information', '> [!NOTE]\n> '.length)],
  ['Tip alert block', 'M9 18h6M10 22h4M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5.6.6 1.27 1.34 1.41 2.5', () => insertBlock('> [!TIP]\n> Helpful advice', '> [!TIP]\n> '.length)],
  ['Important alert block', 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2zM12 8v4M12 15h.01', () => insertBlock('> [!IMPORTANT]\n> Key information', '> [!IMPORTANT]\n> '.length)],
  ['Warning alert block', 'm10.3 3.9-8.2 14A2 2 0 0 0 3.8 21h16.4a2 2 0 0 0 1.7-3l-8.2-14a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01', () => insertBlock('> [!WARNING]\n> Urgent information', '> [!WARNING]\n> '.length)],
  ['Caution alert block', 'M12 16h.01M12 8v4M7.86 2h8.28L22 7.86v8.28L16.14 22H7.86L2 16.14V7.86z', () => insertBlock('> [!CAUTION]\n> Risks or negative outcomes', '> [!CAUTION]\n> '.length)],
];

const BULB_ITEMS = [
  {
    label: 'Inline LaTeX',
    sample: '$E = mc^2$',
    insert: () => wrapSelection('$', '$', 'E = mc^2'),
  },
  {
    label: 'Block LaTeX',
    sample: '$$ \\int_a^b f(x)\\,dx $$',
    insert: () => insertBlock('$$\n\\int_a^b f(x)\\,dx\n$$', 3),
  },
  {
    label: 'Mermaid flowchart',
    sample: 'flowchart LR\n  A --> B',
    insert: () => insertBlock('```mermaid\nflowchart LR\n  A[Start] --> B{Decision}\n  B -->|Yes| C[Done]\n```', 11),
  },
];

function makeIconButton(label, pathD, onClick, kbdKey) {
  const btn = document.createElement('button');
  btn.className = 'icon-btn btn-ghost';
  btn.setAttribute('aria-label', label);
  btn.title = kbdKey ? `${label} (⌘${kbdKey.toUpperCase()})` : label;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of Array.isArray(pathD) ? pathD : [pathD]) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  btn.appendChild(svg);
  btn.addEventListener('click', onClick);
  return btn;
}

export function initRibbon() {
  const holder = document.getElementById('ribbon-buttons');
  for (const def of BUTTONS) {
    if (def === null) {
      const sep = document.createElement('span');
      sep.className = 'mx-1 h-4 w-px bg-edge';
      sep.setAttribute('aria-hidden', 'true');
      holder.appendChild(sep);
      continue;
    }
    holder.appendChild(makeIconButton(...def));
  }

  // 💡 bulb menu — keyboard-navigable, injects at the caret (UX-SPEC §3)
  const bulbBtn = document.getElementById('bulb-btn');
  const menu = document.getElementById('bulb-menu');

  for (const item of BULB_ITEMS) {
    const row = document.createElement('button');
    row.setAttribute('role', 'menuitem');
    row.className = 'flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left text-sm hover:bg-panel-2 cursor-pointer';
    const name = document.createElement('span');
    name.className = 'font-medium';
    name.textContent = item.label;
    const sample = document.createElement('code');
    sample.className = 'text-xs text-ink-muted whitespace-pre-wrap';
    sample.textContent = item.sample;
    row.append(name, sample);
    row.addEventListener('click', () => {
      closeMenu();
      item.insert();
    });
    menu.appendChild(row);
  }

  function openMenu() {
    // fixed-position under the bulb: the ribbon scroller would clip an
    // absolutely-positioned dropdown
    const r = bulbBtn.getBoundingClientRect();
    menu.style.top = r.bottom + 4 + 'px';
    menu.style.left = Math.min(r.left, window.innerWidth - 300) + 'px';
    menu.classList.remove('hidden');
    bulbBtn.setAttribute('aria-expanded', 'true');
    menu.querySelector('[role=menuitem]').focus();
  }
  function closeMenu() {
    menu.classList.add('hidden');
    bulbBtn.setAttribute('aria-expanded', 'false');
  }
  bulbBtn.addEventListener('click', () => {
    menu.classList.contains('hidden') ? openMenu() : closeMenu();
  });
  menu.addEventListener('keydown', (e) => {
    const items = [...menu.querySelectorAll('[role=menuitem]')];
    const idx = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(idx + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(idx - 1 + items.length) % items.length].focus(); }
    else if (e.key === 'Escape') { closeMenu(); bulbBtn.focus(); }
  });
  document.addEventListener('click', (e) => {
    if (!menu.classList.contains('hidden') && !menu.contains(e.target) && e.target !== bulbBtn && !bulbBtn.contains(e.target)) {
      closeMenu();
    }
  });

  // Editor shortcuts: ⌘B / ⌘I / ⌘K (ribbon tooltips advertise these)
  document.getElementById('lb-editor').addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const key = e.key.toLowerCase();
    if (key === 'b') { e.preventDefault(); wrapSelection('**', '**', 'bold'); }
    else if (key === 'i') { e.preventDefault(); wrapSelection('*', '*', 'italic'); }
    else if (key === 'k') { e.preventDefault(); wrapSelection('[', '](https://)', 'link text'); }
  });
}

// Markdown Guide content (sidebar 💡 Guide modal) — documents the quirks the
// edge-case matrix promises we document (§§5.4, 6.2, 7.6).
export const GUIDE_MD = `
## Formatting

| Type | Syntax |
| --- | --- |
| Bold | \`**bold**\` |
| Italic | \`*italic*\` |
| Strikethrough | \`~~text~~\` |
| Superscript | \`x<sup>2</sup>\` → x<sup>2</sup> |
| Subscript | \`H<sub>2</sub>O\` → H<sub>2</sub>O |
| Inline code | \`\` \`code\` \`\` |
| Link | \`[label](https://url)\` |
| Jump to a heading | \`[label](#heading-title)\` |
| Heading | \`# H1\` … \`### H3\` |
| Bulleted list | \`- item\` |
| Numbered list | \`1. item\` |
| Checkbox | \`- [ ] task\` / \`- [x] done\` |

## Math (KaTeX)

Inline: \`$E = mc^2$\` → $E = mc^2$

Block:

\`\`\`
$$
\\int_a^b f(x)\\,dx
$$
\`\`\`

Math inside code spans or fences is left as-is. A stray \`$\` can pair with another \`$\` later in the paragraph — escape prices as \`\\$5\`.

## Diagrams (Mermaid)

\`\`\`mermaid
flowchart LR
  A[Start] --> B{Decision}
  B -->|Yes| C[Done]
\`\`\`

A syntax error shows a local warning chip; the rest of the note still renders.

## Alert blocks

Start a quote with a \`[!TYPE]\` marker on its own line:

> [!NOTE]
> Useful information that users should know, even when skimming content.

> [!TIP]
> Helpful advice for doing things better or more easily.

> [!IMPORTANT]
> Key information users need to know to achieve their goal.

> [!WARNING]
> Urgent info that needs immediate user attention to avoid problems.

> [!CAUTION]
> Advises about risks or negative outcomes of certain actions.

## Frontmatter

A \`---\` fence at the very top of a note — closed by \`---\` or \`...\` — renders as a key/value table instead of a rule:

\`\`\`
---
title: Release notes
tags: [ops, deploy]
owner:
  team: platform
  oncall: rotating
---
\`\`\`

Values show exactly as typed — markdown and math inside them stay literal. Nested keys and lists become tables of their own. A \`---\` anywhere else in the note is still a horizontal rule.

## Good to know

- **Links** to \`https://…\` open in a new tab. A link to \`#a-heading-in-this-note\` scrolls you to that heading instead — same tab, same note. Write the heading in lowercase with hyphens for spaces (*Setup Steps* → \`#setup-steps\`).
- **Tags** are comma-separated — a tag can't contain a comma.
- **Labels** left blank file under *Uncategorized*; sub-labels need a label first.
- **Fields** are your own name/value metadata (e.g. \`os_platform: macOS\`, \`is_valid: true\`). Values are plain text and searchable from the sidebar.
- **Created** is set once and can't be changed. **Modified** updates automatically on every save, but you can set it by hand — an edited value is kept instead of bumping to now.
- **Import** takes \`.md\` files up to 2 MB. The first \`# H1\` becomes the title; YAML frontmatter is kept, and renders as a table.
- **Autosave** snapshots your draft every 10 seconds; you'll be offered a restore after a crash or refresh.
- **Install Bento OS** from the account menu to run it in its own window. Installed, it still opens when you're offline — but your entries live on the server, so you'll see the workspace with an *offline* chip and empty lists until you're back online.
- In prompts, \`{{Variable}}\` fill-ins match literally — \`{{A}}{{B}}\` is two variables, \`{{}}\` is plain text.
`;

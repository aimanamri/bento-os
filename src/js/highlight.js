// Syntax highlighting, shared by the LogBook preview (fenced code blocks) and
// the Code Snippets tab (the body well).
//
// Prism is used through `Prism.tokenize` rather than `Prism.highlight`, so the
// token tree is turned into DOM here with createElement/textContent and no
// HTML string is ever built out of a user's code (SECURITY.md §2 keeps
// innerHTML confined to render.js; this module needs no exception). It also
// means an unknown language degrades to plain text instead of raw markup.

/* global Prism */

// Fence infostrings and snippet categories are freeform, so both are funnelled
// through the same alias table. Categories double as the language label in the
// Snippets tab ("BASH", "SQL", "GENERAL"), hence the tool-ish aliases.
const ALIASES = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', node: 'javascript',
  ts: 'typescript', tsx: 'jsx',
  py: 'python', python3: 'python',
  sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', terminal: 'bash',
  cli: 'bash', command: 'bash', commands: 'bash', curl: 'bash',
  // Tool-named categories in the Snippets tab mean "a command I run", not the
  // tool's output — Prism's own `git` grammar is for diffs and status output,
  // so it is deliberately not bundled and these route to the shell instead.
  git: 'bash', gh: 'bash', npm: 'bash', npx: 'bash', yarn: 'bash', pnpm: 'bash',
  make: 'bash', brew: 'bash', apt: 'bash', ssh: 'bash', tailscale: 'bash',
  supabase: 'bash', psql_cli: 'bash', kubectl: 'bash',
  ps1: 'powershell', pwsh: 'powershell',
  yml: 'yaml',
  dockerfile: 'docker', 'docker-compose': 'docker', compose: 'docker',
  postgres: 'sql', postgresql: 'sql', psql: 'sql', mysql: 'sql',
  sqlite: 'sql', sqlite3: 'sql', plpgsql: 'sql',
  golang: 'go',
  'c++': 'cpp', cxx: 'cpp', h: 'c',
  md: 'markdown',
  htm: 'markup', html: 'markup', xml: 'markup', svg: 'markup',
  conf: 'ini', cfg: 'ini', env: 'ini', toml: 'toml',
  rb: 'ruby',
  patch: 'diff',
};

/**
 * Resolve a fence infostring or snippet category to a loaded Prism grammar
 * name. Returns null for anything unknown ("GENERAL", "notes", "text"), which
 * every caller treats as "render this as plain text".
 */
export function languageOf(hint) {
  if (!hint) return null;
  const key = String(hint).trim().toLowerCase();
  if (!key) return null;
  const name = ALIASES[key] || key;
  return typeof Prism !== 'undefined' && Prism.languages[name] ? name : null;
}

function appendTokens(parent, tokens) {
  for (const token of [].concat(tokens)) {
    if (typeof token === 'string') {
      parent.appendChild(document.createTextNode(token));
      continue;
    }
    const span = document.createElement('span');
    const aliases = Array.isArray(token.alias) ? token.alias : token.alias ? [token.alias] : [];
    span.className = ['token', token.type, ...aliases].join(' ');
    appendTokens(span, token.content);
    parent.appendChild(span);
  }
}

/**
 * Replace `el`'s contents with `code`, coloured if `language` resolves to a
 * grammar. Falls back to plain text — same output the callers produced before
 * — when it doesn't, or if Prism throws on a pathological input.
 *
 * Returns whether it actually highlighted, which snippets.js uses to decide
 * if the "language" label on the card means anything.
 */
export function highlightInto(el, code, language) {
  const name = languageOf(language);
  if (!name) {
    el.textContent = code;
    return false;
  }
  try {
    const tokens = Prism.tokenize(code, Prism.languages[name]);
    el.textContent = '';
    appendTokens(el, tokens);
    return true;
  } catch (e) {
    el.textContent = code;
    return false;
  }
}

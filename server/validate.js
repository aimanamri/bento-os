'use strict';

// Shared input normalization. Every rule here mirrors a row in
// docs/EDGE-CASES.md §6 and must match the client-side normalization.

const TITLE_MAX = 300;
const TAG_MAX = 64;
const TAGS_MAX_COUNT = 32;
const URLS_MAX_COUNT = 64;
const URL_MAX = 2048;
const TEXT_MAX = 1024 * 1024; // 1 MB per text field

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.code = 'VALIDATION';
    this.status = 400;
  }
}

function reqString(value, field, max = TEXT_MAX) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError(`${field} is required`);
  }
  if (value.length > max) {
    throw new ValidationError(`${field} exceeds ${max} characters`);
  }
  return value;
}

function optString(value, field, max = TEXT_MAX) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new ValidationError(`${field} must be a string`);
  if (value.length > max) throw new ValidationError(`${field} exceeds ${max} characters`);
  return value;
}

// "a,, b , A ," -> ["a", "b"]  (split, trim, drop empties, ci-dedupe)
function normalizeTags(value) {
  let items;
  if (Array.isArray(value)) items = value;
  else if (typeof value === 'string') items = value.split(',');
  else if (value === undefined || value === null) items = [];
  else throw new ValidationError('tags must be an array or comma-separated string');

  const seen = new Set();
  const out = [];
  for (const raw of items) {
    if (typeof raw !== 'string') throw new ValidationError('tags must contain strings');
    const tag = raw.replace(/,/g, '').trim().slice(0, TAG_MAX);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= TAGS_MAX_COUNT) break;
  }
  return out;
}

// Invalid items are kept (they may be paths/notes) — validity is a
// client-side rendering concern (EDGE-CASES §6.4). Only shape is enforced.
function normalizeUrls(value) {
  let items;
  if (Array.isArray(value)) items = value;
  else if (typeof value === 'string') items = value.split(',');
  else if (value === undefined || value === null) items = [];
  else throw new ValidationError('urls must be an array or comma-separated string');

  const out = [];
  for (const raw of items) {
    if (typeof raw !== 'string') throw new ValidationError('urls must contain strings');
    const item = raw.trim().slice(0, URL_MAX);
    if (!item) continue;
    out.push(item);
    if (out.length >= URLS_MAX_COUNT) break;
  }
  return out;
}

const FIELD_NAME_MAX = 64;
const FIELD_VALUE_MAX = 2000;
const FIELDS_MAX_COUNT = 64;

// User-defined metadata fields: plain-text name/value pairs (TiddlyWiki
// style). Names are trimmed and deduped case-insensitively (first wins);
// values are coerced to trimmed strings. Insertion order is preserved.
function normalizeFields(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('fields must be an object of name/value pairs');
  }
  const seen = new Set();
  const out = {};
  for (const [rawName, rawValue] of Object.entries(value)) {
    const name = String(rawName).trim().slice(0, FIELD_NAME_MAX);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    if (rawValue !== null && typeof rawValue === 'object') {
      throw new ValidationError(`field "${name}" must have a plain text value`);
    }
    seen.add(key);
    out[name] = String(rawValue ?? '').trim().slice(0, FIELD_VALUE_MAX);
    if (seen.size >= FIELDS_MAX_COUNT) break;
  }
  return out;
}

function normalizeEntry(body) {
  const title = reqString(body.title, 'title', TITLE_MAX).trim();
  const body_md = reqString(body.body_md, 'body_md');
  const summary = optString(body.summary, 'summary', 10000);
  let label = optString(body.label, 'label', 128).trim() || 'Uncategorized';
  let sublabel = optString(body.sublabel, 'sublabel', 128).trim() || null;
  if (label === 'Uncategorized') sublabel = null; // no sublabel without a real label
  return {
    title,
    body_md,
    summary,
    label,
    sublabel,
    fields: JSON.stringify(normalizeFields(body.fields)),
    tags: JSON.stringify(normalizeTags(body.tags)),
    urls: JSON.stringify(normalizeUrls(body.urls)),
  };
}

function normalizePrompt(body) {
  const title = reqString(body.title, 'title', TITLE_MAX).trim();
  const promptBody = reqString(body.body, 'body');
  const category =
    optString(body.category, 'category', 64).trim().toUpperCase() || 'GENERAL';
  const why_this_works = optString(body.why_this_works, 'why_this_works', 10000);
  return {
    title,
    body: promptBody,
    category,
    why_this_works,
    tags: JSON.stringify(normalizeTags(body.tags)),
  };
}

// Code snippets mirror prompts: `category` doubles as the language/tool label
// and `notes` carries the flag/gotcha prose.
function normalizeSnippet(body) {
  const title = reqString(body.title, 'title', TITLE_MAX).trim();
  const snippetBody = reqString(body.body, 'body');
  const category =
    optString(body.category, 'category', 64).trim().toUpperCase() || 'GENERAL';
  const notes = optString(body.notes, 'notes', 10000);
  return {
    title,
    body: snippetBody,
    category,
    notes,
    tags: JSON.stringify(normalizeTags(body.tags)),
  };
}

// FTS5 MATCH takes a query language, not a string — rewrite user input into
// quoted prefix tokens so every token is a literal (SECURITY.md §3).
function ftsQuery(q) {
  // Strip C0 control characters first. A NUL byte in particular is read by
  // FTS5's MATCH parser as a C-string terminator, aborting mid-token with a
  // "SqliteError: unterminated string" that surfaced as a 500; the rest are
  // meaningless in a search token. Mapping them to spaces lets the split below
  // discard them cleanly (\s already covers tab/newline, not NUL/\x01–\x08).
  const cleaned = String(q).replace(/[\u0000-\u001f]/g, ' ');
  const tokens = cleaned.split(/\s+/).filter(Boolean).slice(0, 12);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"*`).join(' ');
}

// Optional user-supplied timestamp (UNIX ms). Modified time is manually
// editable; created time is not (it never reaches an UPDATE — the DB trigger
// still guards it). Returns undefined when absent so the route can default.
function optTimestamp(value, field) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new ValidationError(`${field} must be a positive UNIX ms timestamp`);
  }
  return value;
}

function expectedUpdatedAt(body) {
  const v = body.expected_updated_at;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new ValidationError('expected_updated_at (number) is required for updates');
  }
  return v;
}

// ── auth (local variant) ──────────────────────────────────────
// Usernames match the Supabase variant's rule (2–32 chars, starts
// alphanumeric, then letters/digits/dot/dash/underscore) and are stored
// lowercased so uniqueness is case-insensitive.
const USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{1,31}$/;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 200; // scrypt cost is fixed; cap absurd inputs
const DEFAULT_PASSWORD = 'bentoos';

function normalizeUsername(value) {
  if (typeof value !== 'string' || !USERNAME_RE.test(value.trim())) {
    throw new ValidationError('User ID must be 2–32 characters: letters, digits, dot, dash or underscore');
  }
  return value.trim().toLowerCase();
}

// Login only checks presence — never reveal the format rule to an attacker.
function requirePassword(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationError('Password is required');
  }
  return value;
}

// New passwords (signup / change): enforce policy server-side so a direct API
// call can't set a weak or default password (the gap the Supabase review flagged).
function newPassword(value) {
  if (typeof value !== 'string') throw new ValidationError('Password is required');
  // Default-reuse check first so it gives the accurate message even when the
  // default happens to be shorter than the minimum (e.g. 'bentoos' is 7).
  if (value === DEFAULT_PASSWORD) {
    throw new ValidationError('The default password cannot be reused');
  }
  if (value.length < PASSWORD_MIN) {
    throw new ValidationError(`Password needs at least ${PASSWORD_MIN} characters`);
  }
  if (value.length > PASSWORD_MAX) {
    throw new ValidationError(`Password must be at most ${PASSWORD_MAX} characters`);
  }
  return value;
}

module.exports = {
  ValidationError,
  normalizeEntry,
  normalizePrompt,
  normalizeSnippet,
  normalizeTags,
  ftsQuery,
  expectedUpdatedAt,
  optTimestamp,
  normalizeUsername,
  requirePassword,
  newPassword,
  DEFAULT_PASSWORD,
};

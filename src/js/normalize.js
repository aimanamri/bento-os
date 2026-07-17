// Input normalization, ported from server/validate.js now that writes go
// straight from the browser to Supabase. Every rule mirrors a row in
// docs/EDGE-CASES.md §6. The database CHECK constraints and RLS are the
// authoritative backstop — this layer exists for friendly error messages.

const TITLE_MAX = 300;
const TAG_MAX = 64;
const TAGS_MAX_COUNT = 32;
const URLS_MAX_COUNT = 64;
const URL_MAX = 2048;
const TEXT_MAX = 1024 * 1024; // 1 MB per text field

export class ValidationError extends Error {
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
  if (value.length > max) throw new ValidationError(`${field} exceeds ${max} characters`);
  return value;
}

function optString(value, field, max = TEXT_MAX) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new ValidationError(`${field} must be a string`);
  if (value.length > max) throw new ValidationError(`${field} exceeds ${max} characters`);
  return value;
}

// "a,, b , A ," -> ["a", "b"]  (split, trim, drop empties, ci-dedupe)
export function normalizeTags(value) {
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
export function normalizeUrls(value) {
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

export function normalizeFields(value) {
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

// Tags/fields/urls stay real objects here — Postgres jsonb columns take them
// directly (the SQLite layer JSON.stringify'd them into TEXT).
export function normalizeEntry(body) {
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
    fields: normalizeFields(body.fields),
    tags: normalizeTags(body.tags),
    urls: normalizeUrls(body.urls),
  };
}

export function normalizePrompt(body) {
  const title = reqString(body.title, 'title', TITLE_MAX).trim();
  const promptBody = reqString(body.body, 'body');
  const category = optString(body.category, 'category', 64).trim().toUpperCase() || 'GENERAL';
  const why_this_works = optString(body.why_this_works, 'why_this_works', 10000);
  return { title, body: promptBody, category, why_this_works, tags: normalizeTags(body.tags) };
}

// Code snippets mirror prompts: `category` doubles as the language/tool label
// and `notes` carries the flag/gotcha prose.
export function normalizeSnippet(body) {
  const title = reqString(body.title, 'title', TITLE_MAX).trim();
  const snippetBody = reqString(body.body, 'body');
  const category = optString(body.category, 'category', 64).trim().toUpperCase() || 'GENERAL';
  const notes = optString(body.notes, 'notes', 10000);
  return { title, body: snippetBody, category, notes, tags: normalizeTags(body.tags) };
}

// Optional user-supplied timestamp (UNIX ms). Modified time is manually
// editable; created time is not (the DB trigger guards it).
export function optTimestamp(value, field) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new ValidationError(`${field} must be a positive UNIX ms timestamp`);
  }
  return value;
}

export function expectedUpdatedAt(body) {
  const v = body.expected_updated_at;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new ValidationError('expected_updated_at (number) is required for updates');
  }
  return v;
}

// Markdown import (ported from server/routes/import.js). The filename is used
// only for the fallback title — never as a path.
const MAX_IMPORT_CONTENT = 2 * 1024 * 1024;

export function parseMarkdownImport(filename, content) {
  if (typeof content !== 'string' || typeof filename !== 'string') {
    throw new ValidationError('filename and content are required');
  }
  if (content.length > MAX_IMPORT_CONTENT) {
    throw new ValidationError('Markdown files are limited to 2 MB');
  }
  if (!/\.(md|markdown)$/i.test(filename)) {
    throw new ValidationError('Only .md or .markdown files can be imported');
  }
  if (content.includes('\u0000')) {
    throw new ValidationError('This file is not a markdown text file');
  }
  const replacements = (content.match(/�/g) || []).length;
  if (content.length > 0 && replacements / content.length > 0.05) {
    throw new ValidationError('This file is not valid UTF-8 text');
  }

  // Strip BOM, normalize CRLF/CR → LF (EDGE-CASES §7.5)
  let text = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');

  // Title from the first H1; else filename sans extension (EDGE-CASES §7.1–7.2)
  let title = null;
  const h1 = text.match(/^#[ \t]+(.+)$/m);
  if (h1) {
    title = h1[1].trim().slice(0, 300);
    text = (text.slice(0, h1.index) + text.slice(h1.index + h1[0].length)).replace(/^\n+/, '');
  }
  if (!title) {
    title = filename.replace(/\.(md|markdown)$/i, '').trim().slice(0, 300) || 'Imported note';
  }
  if (text.trim().length === 0) {
    throw new ValidationError('The file has no content to import');
  }
  return { title, body_md: text };
}

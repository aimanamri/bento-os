// Data layer: same api(path, { method, body }) contract the UI has always
// used, now dispatching to the Supabase SDK instead of the local Express
// API. Response shapes, error codes (VALIDATION / NOT_FOUND / CONFLICT /
// NETWORK) and the 409 payload contract are preserved so logbook.js,
// prompts.js and snippets.js work unchanged.
//
// RLS note: every query here implicitly carries `user_id = auth.uid()` —
// the database, not this file, is what enforces per-user isolation.

import { sb } from './supabase.js';
import {
  normalizeEntry,
  normalizePrompt,
  normalizeSnippet,
  optTimestamp,
  expectedUpdatedAt,
  parseMarkdownImport,
  ValidationError,
} from './normalize.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase-config.js';

export const SCHEMA_VERSION = 4; // Supabase/Postgres era (4 adds snippets)

export class ApiError extends Error {
  constructor(status, code, message, payload) {
    super(message);
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

// Columns the sidebar list needs (fields rides along for name suggestions).
const ENTRY_LIST_COLS = 'id, title, summary, label, sublabel, tags, fields, created_at, updated_at';

const TIMEOUT_MS = 10000;

// Strip C0 control characters before full-text search. A NUL byte in
// particular cannot exist in a Postgres text value, so it aborts the request;
// the rest are meaningless in a search term. Mapping them to spaces lets them
// act as token delimiters. Mirrors the local variant's ftsQuery hardening.
function ftsClean(q) {
  return String(q).replace(/[\u0000-\u001f]/g, ' ').trim();
}

// Supabase queries get the same 10 s budget the old fetch wrapper had
// (EDGE-CASES §3.5). PostgREST builders are thenables, so race them.
async function run(builder) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new ApiError(0, 'NETWORK', "Couldn't reach the Bento host", null)), TIMEOUT_MS);
  });
  try {
    return await Promise.race([builder, timeout]);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, 'NETWORK', "Couldn't reach the Bento host", null);
  } finally {
    clearTimeout(timer);
  }
}

function throwDbError(error) {
  // 23514 = CHECK violation → same message the SQLite layer produced
  if (error.code === '23514') {
    throw new ApiError(400, 'VALIDATION', 'Entry needs a non-empty title and details', null);
  }
  if (error.code === 'PGRST116') {
    throw new ApiError(404, 'NOT_FOUND', 'Not found', null);
  }
  throw new ApiError(500, 'INTERNAL', error.message || 'Something went wrong', null);
}

async function currentUserId() {
  const { data } = await sb.auth.getSession();
  const uid = data?.session?.user?.id;
  if (!uid) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in required', null);
  return uid;
}

/* ── entries ────────────────────────────────────────────────── */

async function listEntries(params) {
  const q = params.get('q');
  const tag = params.get('tag');
  const label = params.get('label');

  let query = sb.from('entries').select(ENTRY_LIST_COLS);
  const search = q ? ftsClean(q) : '';
  if (search) {
    // Native Postgres FTS over the generated tsvector column (GIN-indexed).
    query = query.textSearch('search', search, { type: 'websearch', config: 'english' });
  }
  if (tag && tag.trim()) query = query.contains('tags', JSON.stringify([tag.trim()]));
  if (label && label.trim()) query = query.eq('label', label.trim());
  query = query.order('updated_at', { ascending: false });

  const { data, error } = await run(query);
  if (error) throwDbError(error);
  return { entries: data };
}

async function getEntry(id) {
  const { data, error } = await run(sb.from('entries').select('*').eq('id', id).maybeSingle());
  if (error) throwDbError(error);
  if (!data) throw new ApiError(404, 'NOT_FOUND', 'Entry not found', null);
  return { entry: data };
}

async function createEntry(body) {
  const data = normalizeEntry(body);
  const now = Date.now();
  const updated_at = optTimestamp(body.updated_at, 'updated_at') ?? now;
  const user_id = await currentUserId();
  const { data: row, error } = await run(
    sb.from('entries').insert({ ...data, user_id, created_at: now, updated_at }).select().single()
  );
  if (error) throwDbError(error);
  return { entry: row };
}

async function updateEntry(id, body) {
  const expected = expectedUpdatedAt(body);
  const data = normalizeEntry(body);
  const now = Date.now();
  const updated_at = optTimestamp(body.updated_at, 'updated_at') ?? now;

  // Optimistic concurrency without a server transaction: the UPDATE only
  // matches when updated_at is still what the client last saw. Zero rows
  // back means deleted (404) or changed elsewhere (409 with current row).
  const { data: rows, error } = await run(
    sb.from('entries').update({ ...data, updated_at }).eq('id', id).eq('updated_at', expected).select()
  );
  if (error) throwDbError(error);
  if (rows.length > 0) return { entry: rows[0] };

  const { data: current } = await run(sb.from('entries').select('*').eq('id', id).maybeSingle());
  if (!current) {
    throw new ApiError(404, 'NOT_FOUND', 'Entry not found — it may have been deleted on another device', null);
  }
  throw new ApiError(409, 'CONFLICT', 'Entry was saved on another device', {
    error: { code: 'CONFLICT', message: 'Entry was saved on another device' },
    entry: current,
  });
}

async function deleteEntry(id) {
  // Hard delete (GDPR §4) — the row is permanently removed.
  const { data: rows, error } = await run(sb.from('entries').delete().eq('id', id).select('id'));
  if (error) throwDbError(error);
  if (rows.length === 0) throw new ApiError(404, 'NOT_FOUND', 'Entry not found', null);
  return { ok: true };
}

async function importEntry(body) {
  const { title, body_md } = parseMarkdownImport(body?.filename, body?.content);
  const now = Date.now();
  const user_id = await currentUserId();
  const { data: row, error } = await run(
    sb.from('entries')
      .insert({ user_id, title, body_md, summary: '', label: 'Uncategorized', created_at: now, updated_at: now })
      .select()
      .single()
  );
  if (error) throwDbError(error);
  return { entry: row };
}

/* ── prompts ────────────────────────────────────────────────── */

async function getPrompt(id) {
  const { data, error } = await run(sb.from('prompts').select('*').eq('id', id).maybeSingle());
  if (error) throwDbError(error);
  if (!data) throw new ApiError(404, 'NOT_FOUND', 'Prompt not found', null);
  return { prompt: data };
}

async function listPrompts(params) {
  const q = params.get('q');
  const tag = params.get('tag');

  let query = sb.from('prompts').select('*');
  const search = q ? ftsClean(q) : '';
  if (search) {
    query = query.textSearch('search', search, { type: 'websearch', config: 'english' });
  }
  if (tag && tag.trim()) query = query.contains('tags', JSON.stringify([tag.trim()]));
  query = query.order('category', { ascending: true }).order('title', { ascending: true });

  const { data, error } = await run(query);
  if (error) throwDbError(error);
  return { prompts: data };
}

async function createPrompt(body) {
  const data = normalizePrompt(body);
  const now = Date.now();
  const user_id = await currentUserId();
  const { data: row, error } = await run(
    sb.from('prompts').insert({ ...data, user_id, created_at: now, updated_at: now }).select().single()
  );
  if (error) throwDbError(error);
  return { prompt: row };
}

async function updatePrompt(id, body) {
  const expected = expectedUpdatedAt(body);
  const data = normalizePrompt(body);
  const now = Date.now();

  const { data: rows, error } = await run(
    sb.from('prompts').update({ ...data, updated_at: now }).eq('id', id).eq('updated_at', expected).select()
  );
  if (error) throwDbError(error);
  if (rows.length > 0) return { prompt: rows[0] };

  const { data: current } = await run(sb.from('prompts').select('*').eq('id', id).maybeSingle());
  if (!current) {
    throw new ApiError(404, 'NOT_FOUND', 'Prompt not found — it may have been deleted on another device', null);
  }
  throw new ApiError(409, 'CONFLICT', 'Prompt was saved on another device', {
    error: { code: 'CONFLICT', message: 'Prompt was saved on another device' },
    prompt: current,
  });
}

async function deletePrompt(id) {
  const { data: rows, error } = await run(sb.from('prompts').delete().eq('id', id).select('id'));
  if (error) throwDbError(error);
  if (rows.length === 0) throw new ApiError(404, 'NOT_FOUND', 'Prompt not found', null);
  return { ok: true };
}

/* ── snippets ───────────────────────────────────────────────── */

async function getSnippet(id) {
  const { data, error } = await run(sb.from('snippets').select('*').eq('id', id).maybeSingle());
  if (error) throwDbError(error);
  if (!data) throw new ApiError(404, 'NOT_FOUND', 'Snippet not found', null);
  return { snippet: data };
}

async function listSnippets(params) {
  const q = params.get('q');
  const tag = params.get('tag');

  let query = sb.from('snippets').select('*');
  const search = q ? ftsClean(q) : '';
  if (search) {
    query = query.textSearch('search', search, { type: 'websearch', config: 'english' });
  }
  if (tag && tag.trim()) query = query.contains('tags', JSON.stringify([tag.trim()]));
  query = query.order('category', { ascending: true }).order('title', { ascending: true });

  const { data, error } = await run(query);
  if (error) throwDbError(error);
  return { snippets: data };
}

async function createSnippet(body) {
  const data = normalizeSnippet(body);
  const now = Date.now();
  const user_id = await currentUserId();
  const { data: row, error } = await run(
    sb.from('snippets').insert({ ...data, user_id, created_at: now, updated_at: now }).select().single()
  );
  if (error) throwDbError(error);
  return { snippet: row };
}

async function updateSnippet(id, body) {
  const expected = expectedUpdatedAt(body);
  const data = normalizeSnippet(body);
  const now = Date.now();

  const { data: rows, error } = await run(
    sb.from('snippets').update({ ...data, updated_at: now }).eq('id', id).eq('updated_at', expected).select()
  );
  if (error) throwDbError(error);
  if (rows.length > 0) return { snippet: rows[0] };

  const { data: current } = await run(sb.from('snippets').select('*').eq('id', id).maybeSingle());
  if (!current) {
    throw new ApiError(404, 'NOT_FOUND', 'Snippet not found — it may have been deleted on another device', null);
  }
  throw new ApiError(409, 'CONFLICT', 'Snippet was saved on another device', {
    error: { code: 'CONFLICT', message: 'Snippet was saved on another device' },
    snippet: current,
  });
}

async function deleteSnippet(id) {
  const { data: rows, error } = await run(sb.from('snippets').delete().eq('id', id).select('id'));
  if (error) throwDbError(error);
  if (rows.length === 0) throw new ApiError(404, 'NOT_FOUND', 'Snippet not found', null);
  return { ok: true };
}

/* ── health ─────────────────────────────────────────────────── */

async function health() {
  // GoTrue health endpoint: cheap reachability probe, no auth required.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: SUPABASE_ANON_KEY },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error('unhealthy');
  } catch (e) {
    throw new ApiError(0, 'NETWORK', "Couldn't reach Supabase", null);
  } finally {
    clearTimeout(timer);
  }
  return { ok: true, schema: SCHEMA_VERSION, now: Date.now() };
}

/* ── router ─────────────────────────────────────────────────── */

export async function api(path, { method = 'GET', body } = {}) {
  const url = new URL(path, location.origin);
  const parts = url.pathname.split('/').filter(Boolean); // ['api', resource, id?]
  const resource = parts[1];
  const id = parts[2];

  try {
    if (resource === 'health') return await health();

    if (resource === 'entries') {
      if (method === 'GET') return id ? await getEntry(id) : await listEntries(url.searchParams);
      if (method === 'POST') return await createEntry(body);
      if (method === 'PUT') return await updateEntry(id, body);
      if (method === 'DELETE') return await deleteEntry(id);
    }
    if (resource === 'prompts') {
      if (method === 'GET') return id ? await getPrompt(id) : await listPrompts(url.searchParams);
      if (method === 'POST') return await createPrompt(body);
      if (method === 'PUT') return await updatePrompt(id, body);
      if (method === 'DELETE') return await deletePrompt(id);
    }
    if (resource === 'snippets') {
      if (method === 'GET') return id ? await getSnippet(id) : await listSnippets(url.searchParams);
      if (method === 'POST') return await createSnippet(body);
      if (method === 'PUT') return await updateSnippet(id, body);
      if (method === 'DELETE') return await deleteSnippet(id);
    }
    if (resource === 'import' && method === 'POST') return await importEntry(body);
  } catch (e) {
    if (e instanceof ValidationError) throw new ApiError(400, 'VALIDATION', e.message, null);
    throw e;
  }

  throw new ApiError(404, 'NOT_FOUND', 'Unknown API route', null);
}

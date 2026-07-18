// POST { action: 'fetch', skill_id, force? } | { action: 'refresh', skill_ids[] }
// Server-side-only gateway to GitHub for the Skills tab (client CSP forbids
// external fetches; skills.sh's own API requires Vercel OIDC and is
// unreachable from self-hosted Bento OS — see the implementation plan's
// "Verified external facts"). Any authenticated role may call this.
//
// Caching (1h TTL) + a global GitHub budget protect the shared
// unauthenticated quota (60 req/hr per IP): when the budget is exhausted we
// serve whatever is cached rather than fail every caller's request.
//
//   fetch   → { skill_md, upstream_sha, fetched_at, cached }
//   refresh → { shas: { [skill_id]: sha|null } }  (sha-only, for update alerts)

import { corsHeaders, errorResponse, getCaller, json, serviceClient, withinRateLimit } from '../_shared/mod.ts';
import type { Caller } from '../_shared/mod.ts';

const CACHE_TTL_MS = 60 * 60 * 1000; // 1h
const FETCH_TIMEOUT_MS = 8000;
const MAX_PER_USER_HOUR = 30;
const MAX_GITHUB_PER_HOUR = 40;
const MAX_REFRESH_IDS = 20;
const GITHUB_TOKEN = Deno.env.get('GITHUB_TOKEN');

function githubHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { 'User-Agent': 'bento-os-skills-proxy', ...extra };
  if (GITHUB_TOKEN) headers['Authorization'] = `Bearer ${GITHUB_TOKEN}`;
  return headers;
}

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

type SkillMdResult = { notModified: true } | { notModified: false; content: string; etag: string | null };

// Raw content fetch — this is what the user actually reads/downloads.
async function fetchSkillMd(owner: string, repo: string, skillPath: string, priorEtag: string | null): Promise<SkillMdResult> {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${skillPath}/SKILL.md`;
  const headers = githubHeaders(priorEtag ? { 'If-None-Match': priorEtag } : {});
  const res = await fetchWithTimeout(url, { headers });
  if (res.status === 304) return { notModified: true };
  if (!res.ok) throw new Error(`raw fetch ${res.status}`);
  const content = await res.text();
  return { notModified: false, content, etag: res.headers.get('etag') };
}

// Tree SHA of the skill folder — matches the vercel-labs CLI's own update
// check: GET contents of the parent dir, find the folder entry, read .sha.
async function fetchTreeSha(owner: string, repo: string, skillPath: string): Promise<string | null> {
  const idx = skillPath.lastIndexOf('/');
  const parent = idx === -1 ? '' : skillPath.slice(0, idx);
  const name = idx === -1 ? skillPath : skillPath.slice(idx + 1);
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${parent}`;
  const res = await fetchWithTimeout(url, { headers: githubHeaders({ Accept: 'application/vnd.github+json' }) });
  if (!res.ok) throw new Error(`contents fetch ${res.status}`);
  const entries = await res.json();
  const dir = Array.isArray(entries) ? entries.find((e: { type: string; name: string }) => e.type === 'dir' && e.name === name) : null;
  return dir?.sha ?? null;
}

async function handleFetch(caller: Caller, body: Record<string, unknown>): Promise<Response> {
  const skillId = String(body.skill_id ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(skillId)) {
    return errorResponse(400, 'VALIDATION', 'skill_id (uuid) is required');
  }
  const force = !!body.force;

  if (!(await withinRateLimit(`skills:${caller.id}`, MAX_PER_USER_HOUR, 3600))) {
    return errorResponse(429, 'RATE_LIMITED', 'Too many skill fetches — try again later');
  }

  const svc = serviceClient();
  const { data: skill } = await svc.from('skill_catalog').select('*').eq('id', skillId).maybeSingle();
  if (!skill) return errorResponse(404, 'NOT_FOUND', 'Skill not found');

  const { data: cache } = await svc.from('skill_cache').select('*').eq('skill_id', skillId).maybeSingle();
  const fresh = !!cache && Date.now() - new Date(cache.fetched_at).getTime() < CACHE_TTL_MS;

  if (fresh && !force) {
    return json(200, {
      skill_md: cache.skill_md,
      upstream_sha: cache.upstream_sha,
      fetched_at: new Date(cache.fetched_at).getTime(),
      cached: true,
    });
  }

  // Global GitHub budget, shared across every caller and skill: exhausting
  // it must never fail a request that already has something to show.
  if (!(await withinRateLimit('skills:github', MAX_GITHUB_PER_HOUR, 3600))) {
    if (cache) {
      return json(200, {
        skill_md: cache.skill_md,
        upstream_sha: cache.upstream_sha,
        fetched_at: new Date(cache.fetched_at).getTime(),
        cached: true,
        stale: true,
      });
    }
    return errorResponse(502, 'UPSTREAM', 'GitHub is temporarily unavailable and no cached copy exists');
  }

  try {
    const [contentResult, upstream_sha] = await Promise.all([
      fetchSkillMd(skill.owner, skill.repo, skill.skill_path, force ? null : (cache?.etag ?? null)),
      fetchTreeSha(skill.owner, skill.repo, skill.skill_path),
    ]);

    const nowIso = new Date().toISOString();

    if (contentResult.notModified) {
      await svc.from('skill_cache').update({ upstream_sha, fetched_at: nowIso }).eq('skill_id', skillId);
      return json(200, { skill_md: cache!.skill_md, upstream_sha, fetched_at: Date.parse(nowIso), cached: true });
    }

    await svc.from('skill_cache').upsert(
      { skill_id: skillId, skill_md: contentResult.content, upstream_sha, etag: contentResult.etag, fetched_at: nowIso },
      { onConflict: 'skill_id' },
    );
    return json(200, { skill_md: contentResult.content, upstream_sha, fetched_at: Date.parse(nowIso), cached: false });
  } catch (e) {
    console.error('[skills-proxy] fetch failed', (e as Error).message);
    if (cache) {
      return json(200, {
        skill_md: cache.skill_md,
        upstream_sha: cache.upstream_sha,
        fetched_at: new Date(cache.fetched_at).getTime(),
        cached: true,
        stale: true,
      });
    }
    return errorResponse(502, 'UPSTREAM', 'Could not reach GitHub and no cached copy exists');
  }
}

async function handleRefresh(caller: Caller, body: Record<string, unknown>): Promise<Response> {
  const ids = Array.isArray(body.skill_ids) ? body.skill_ids.filter((x): x is string => typeof x === 'string') : [];
  if (ids.length === 0 || ids.length > MAX_REFRESH_IDS) {
    return errorResponse(400, 'VALIDATION', `skill_ids must be a non-empty array of up to ${MAX_REFRESH_IDS} ids`);
  }
  if (!(await withinRateLimit(`skills:${caller.id}`, MAX_PER_USER_HOUR, 3600))) {
    return errorResponse(429, 'RATE_LIMITED', 'Too many refresh requests — try again later');
  }

  const svc = serviceClient();
  const { data: rows } = await svc.from('skill_catalog').select('id, owner, repo, skill_path').in('id', ids);
  const shas: Record<string, string | null> = {};

  for (const row of rows ?? []) {
    if (!(await withinRateLimit('skills:github', MAX_GITHUB_PER_HOUR, 3600))) {
      shas[row.id] = null; // budget exhausted mid-batch — next refresh picks it up
      continue;
    }
    try {
      const sha = await fetchTreeSha(row.owner, row.repo, row.skill_path);
      shas[row.id] = sha;
      // sha-only write-through so listSkills()'s update_available flag stays
      // fresh without re-fetching/storing the full SKILL.md body.
      const { error: cacheErr } = await svc
        .from('skill_cache')
        .upsert({ skill_id: row.id, upstream_sha: sha, fetched_at: new Date().toISOString() }, { onConflict: 'skill_id' });
      if (cacheErr) console.error('[skills-proxy] cache upsert failed', cacheErr.message);
    } catch {
      shas[row.id] = null;
    }
  }

  return json(200, { shas });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return errorResponse(405, 'METHOD', 'POST only');

  const caller = await getCaller(req);
  if (!caller) return errorResponse(401, 'UNAUTHENTICATED', 'Sign in required');

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, 'BAD_JSON', 'Request body is not valid JSON');
  }

  if (body.action === 'fetch') return await handleFetch(caller, body);
  if (body.action === 'refresh') return await handleRefresh(caller, body);
  return errorResponse(400, 'VALIDATION', 'Unknown action');
});

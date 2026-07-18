'use strict';

// Skills tab: curated, server-seeded catalog of agent skills (vercel-labs
// ecosystem) + per-user install tracking + a server-only GitHub content
// cache. Mounted behind [requireAuth, requirePasswordChanged] in index.js,
// same as snippets.js. Mirrors the Supabase variant's skills-proxy Edge
// Function (supabase/functions/skills-proxy/index.ts), ported from
// Deno/TS to plain Node — see docs/IMPLEMENTATION-LOCAL.md and the
// implementation plan's "Verified external facts".
//
//   GET    /api/skills             merged catalog + install state + upstream sha
//   GET    /api/skills/:id?force=1 cache-or-fetch SKILL.md content
//   POST   /api/skills/:id/install {sha}  mark installed
//   DELETE /api/skills/:id/install         mark not installed
//   POST   /api/skills/refresh     {ids}  sha-only refresh (update alerts)

const express = require('express');
const { db } = require('../db');
const { withinRateLimit } = require('../auth');
const { sendError } = require('../errors');

const router = express.Router();

const CACHE_TTL_MS = 60 * 60 * 1000; // 1h
const FETCH_TIMEOUT_MS = 8000;
const MAX_PER_USER_HOUR = 30;
const MAX_GITHUB_PER_HOUR = 40;
const MAX_REFRESH_IDS = 20;
const HOUR_MS = 60 * 60 * 1000;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

function parseId(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function rowOut(row) {
  if (!row) return row;
  return { ...row, tags: JSON.parse(row.tags) };
}

function githubHeaders(extra = {}) {
  const headers = { 'User-Agent': 'bento-os-skills', ...extra };
  if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  return headers;
}

async function fetchWithTimeout(url, init = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Raw content fetch — this is what the user actually reads/downloads.
async function fetchSkillMd(owner, repo, skillPath, priorEtag) {
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
async function fetchTreeSha(owner, repo, skillPath) {
  const idx = skillPath.lastIndexOf('/');
  const parent = idx === -1 ? '' : skillPath.slice(0, idx);
  const name = idx === -1 ? skillPath : skillPath.slice(idx + 1);
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${parent}`;
  const res = await fetchWithTimeout(url, { headers: githubHeaders({ Accept: 'application/vnd.github+json' }) });
  if (!res.ok) throw new Error(`contents fetch ${res.status}`);
  const entries = await res.json();
  const dir = Array.isArray(entries) ? entries.find((e) => e.type === 'dir' && e.name === name) : null;
  return dir?.sha ?? null;
}

function upsertCache({ skill_id, skill_md, upstream_sha, etag, fetched_at }) {
  db.prepare(
    `INSERT INTO skill_cache (skill_id, skill_md, upstream_sha, etag, fetched_at)
     VALUES (@skill_id, @skill_md, @upstream_sha, @etag, @fetched_at)
     ON CONFLICT(skill_id) DO UPDATE SET
       skill_md = excluded.skill_md, upstream_sha = excluded.upstream_sha,
       etag = excluded.etag, fetched_at = excluded.fetched_at`
  ).run({ skill_id, skill_md, upstream_sha, etag, fetched_at });
}

function upsertShaOnly(skill_id, upstream_sha, fetched_at) {
  db.prepare(
    `INSERT INTO skill_cache (skill_id, upstream_sha, fetched_at) VALUES (?, ?, ?)
     ON CONFLICT(skill_id) DO UPDATE SET upstream_sha = excluded.upstream_sha, fetched_at = excluded.fetched_at`
  ).run(skill_id, upstream_sha, fetched_at);
}

/* ── list (merged catalog + install state) ───────────────────── */

router.get('/', (req, res) => {
  const rows = db.prepare(
    `SELECT c.*,
            CASE WHEN us.user_id IS NOT NULL THEN 1 ELSE 0 END AS installed,
            us.installed_sha AS installed_sha,
            cache.upstream_sha AS upstream_sha
       FROM skill_catalog c
       LEFT JOIN user_skills us    ON us.skill_id = c.id AND us.user_id = ?
       LEFT JOIN skill_cache cache ON cache.skill_id = c.id
      ORDER BY c.category, c.name`
  ).all(req.user.id);

  const skills = rows.map((r) => {
    const installed = !!r.installed;
    const upstream_sha = r.upstream_sha ?? null;
    return {
      ...rowOut(r),
      installed,
      installed_sha: r.installed_sha ?? null,
      upstream_sha,
      update_available: !!(installed && upstream_sha && r.installed_sha !== upstream_sha),
    };
  });
  res.json({ skills });
});

/* ── detail (cache-or-fetch SKILL.md) ─────────────────────────── */

router.get('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return sendError(res, 400, 'VALIDATION', 'Invalid skill id');

  const skill = db.prepare('SELECT * FROM skill_catalog WHERE id = ?').get(id);
  if (!skill) return sendError(res, 404, 'NOT_FOUND', 'Skill not found');

  const force = req.query.force === '1';
  if (!withinRateLimit(`skills:${req.user.id}`, MAX_PER_USER_HOUR, HOUR_MS)) {
    return sendError(res, 429, 'RATE_LIMITED', 'Too many skill fetches — try again later');
  }

  const cache = db.prepare('SELECT * FROM skill_cache WHERE skill_id = ?').get(id);
  const fresh = !!cache && Date.now() - cache.fetched_at < CACHE_TTL_MS;

  if (fresh && !force) {
    return res.json({
      skill: rowOut(skill), skill_md: cache.skill_md, upstream_sha: cache.upstream_sha,
      fetched_at: cache.fetched_at, cached: true,
    });
  }

  // Global GitHub budget, shared across every caller and skill: exhausting
  // it must never fail a request that already has something to show.
  if (!withinRateLimit('skills:github', MAX_GITHUB_PER_HOUR, HOUR_MS)) {
    if (cache) {
      return res.json({
        skill: rowOut(skill), skill_md: cache.skill_md, upstream_sha: cache.upstream_sha,
        fetched_at: cache.fetched_at, cached: true, stale: true,
      });
    }
    return sendError(res, 502, 'UPSTREAM', 'GitHub is temporarily unavailable and no cached copy exists');
  }

  try {
    const [contentResult, upstream_sha] = await Promise.all([
      fetchSkillMd(skill.owner, skill.repo, skill.skill_path, force ? null : (cache?.etag ?? null)),
      fetchTreeSha(skill.owner, skill.repo, skill.skill_path),
    ]);
    const now = Date.now();

    if (contentResult.notModified) {
      upsertCache({ skill_id: id, skill_md: cache.skill_md, upstream_sha, etag: cache.etag, fetched_at: now });
      return res.json({ skill: rowOut(skill), skill_md: cache.skill_md, upstream_sha, fetched_at: now, cached: true });
    }

    upsertCache({ skill_id: id, skill_md: contentResult.content, upstream_sha, etag: contentResult.etag, fetched_at: now });
    return res.json({
      skill: rowOut(skill), skill_md: contentResult.content, upstream_sha, fetched_at: now, cached: false,
    });
  } catch (e) {
    console.error('[skills] fetch failed', e.message);
    if (cache) {
      return res.json({
        skill: rowOut(skill), skill_md: cache.skill_md, upstream_sha: cache.upstream_sha,
        fetched_at: cache.fetched_at, cached: true, stale: true,
      });
    }
    return sendError(res, 502, 'UPSTREAM', 'Could not reach GitHub and no cached copy exists');
  }
});

/* ── install tracking ─────────────────────────────────────────── */

router.post('/:id/install', (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return sendError(res, 400, 'VALIDATION', 'Invalid skill id');
  const skill = db.prepare('SELECT id FROM skill_catalog WHERE id = ?').get(id);
  if (!skill) return sendError(res, 404, 'NOT_FOUND', 'Skill not found');

  const sha = typeof req.body?.sha === 'string' ? req.body.sha : null;
  db.prepare(
    `INSERT INTO user_skills (user_id, skill_id, installed_sha, installed_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, skill_id) DO UPDATE SET installed_sha = excluded.installed_sha, installed_at = excluded.installed_at`
  ).run(req.user.id, id, sha, Date.now());
  res.json({ ok: true });
});

router.delete('/:id/install', (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return sendError(res, 400, 'VALIDATION', 'Invalid skill id');
  db.prepare('DELETE FROM user_skills WHERE user_id = ? AND skill_id = ?').run(req.user.id, id);
  res.json({ ok: true });
});

/* ── refresh (sha-only, for update alerts) ────────────────────── */

router.post('/refresh', async (req, res) => {
  const raw = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const ids = [...new Set(raw.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0))];
  if (ids.length === 0 || ids.length > MAX_REFRESH_IDS) {
    return sendError(res, 400, 'VALIDATION', `ids must be a non-empty array of up to ${MAX_REFRESH_IDS} skill ids`);
  }
  if (!withinRateLimit(`skills:${req.user.id}`, MAX_PER_USER_HOUR, HOUR_MS)) {
    return sendError(res, 429, 'RATE_LIMITED', 'Too many refresh requests — try again later');
  }

  const rows = db.prepare(
    `SELECT id, owner, repo, skill_path FROM skill_catalog WHERE id IN (${ids.map(() => '?').join(',')})`
  ).all(...ids);

  const shas = {};
  for (const row of rows) {
    if (!withinRateLimit('skills:github', MAX_GITHUB_PER_HOUR, HOUR_MS)) {
      shas[row.id] = null; // budget exhausted mid-batch — next refresh picks it up
      continue;
    }
    try {
      const sha = await fetchTreeSha(row.owner, row.repo, row.skill_path);
      shas[row.id] = sha;
      upsertShaOnly(row.id, sha, Date.now());
    } catch (e) {
      shas[row.id] = null;
    }
  }
  res.json({ shas });
});

module.exports = router;

'use strict';

const express = require('express');
const { db } = require('../db');
const { normalizePrompt, ftsQuery, expectedUpdatedAt } = require('../validate');
const { sendError } = require('../errors');

const router = express.Router();

function rowOut(row) {
  if (!row) return row;
  return { ...row, tags: JSON.parse(row.tags) };
}

// Per-user isolation (DATABASE-LOCAL §4): every statement carries a user_id
// predicate; a miss returns 404, never 403.
router.get('/', (req, res) => {
  const userId = req.user.id;
  const { q, tag } = req.query;
  const conds = ['p.user_id = ?'];
  const params = [userId];

  if (typeof tag === 'string' && tag.trim()) {
    conds.push('EXISTS (SELECT 1 FROM json_each(p.tags) jt WHERE lower(jt.value) = lower(?))');
    params.push(tag.trim());
  }

  let sql;
  const match = typeof q === 'string' ? ftsQuery(q) : null;
  if (match) {
    sql = `SELECT p.* FROM prompts_fts f JOIN prompts p ON p.id = f.rowid
           WHERE prompts_fts MATCH ? AND ${conds.join(' AND ')}
           ORDER BY rank`;
    params.unshift(match);
  } else {
    sql = `SELECT p.* FROM prompts p
           WHERE ${conds.join(' AND ')}
           ORDER BY p.category ASC, p.title ASC`;
  }

  res.json({ prompts: db.prepare(sql).all(...params).map(rowOut) });
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM prompts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!row) return sendError(res, 404, 'NOT_FOUND', 'Prompt not found');
  res.json({ prompt: rowOut(row) });
});

router.post('/', (req, res) => {
  const data = normalizePrompt(req.body);
  const now = Date.now();
  const info = db
    .prepare(
      `INSERT INTO prompts (user_id, title, category, body, why_this_works, tags, created_at, updated_at)
       VALUES (@user_id, @title, @category, @body, @why_this_works, @tags, @created_at, @updated_at)`
    )
    .run({ ...data, user_id: req.user.id, created_at: now, updated_at: now });
  const row = db.prepare('SELECT * FROM prompts WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ prompt: rowOut(row) });
});

router.put('/:id', (req, res) => {
  const userId = req.user.id;
  const expected = expectedUpdatedAt(req.body);
  const data = normalizePrompt(req.body);
  const now = Date.now();

  const result = db.transaction(() => {
    const current = db.prepare('SELECT * FROM prompts WHERE id = ? AND user_id = ?').get(req.params.id, userId);
    if (!current) return { status: 404 };
    if (current.updated_at !== expected) return { status: 409, current };
    db.prepare(
      `UPDATE prompts SET title=@title, category=@category, body=@body,
       why_this_works=@why_this_works, tags=@tags, updated_at=@updated_at WHERE id=@id AND user_id=@user_id`
    ).run({ ...data, updated_at: now, id: current.id, user_id: userId });
    return { status: 200, row: db.prepare('SELECT * FROM prompts WHERE id = ?').get(current.id) };
  })();

  if (result.status === 404) return sendError(res, 404, 'NOT_FOUND', 'Prompt not found — it may have been deleted on another device');
  if (result.status === 409) {
    return res.status(409).json({
      error: { code: 'CONFLICT', message: 'Prompt was saved on another device' },
      prompt: rowOut(result.current),
    });
  }
  res.json({ prompt: rowOut(result.row) });
});

router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM prompts WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  if (info.changes === 0) return sendError(res, 404, 'NOT_FOUND', 'Prompt not found');
  res.json({ ok: true });
});

module.exports = router;

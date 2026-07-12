'use strict';

const express = require('express');
const { db } = require('../db');
const { normalizeEntry, ftsQuery, expectedUpdatedAt, optTimestamp, ValidationError } = require('../validate');
const { sendError } = require('../errors');

const router = express.Router();

// `fields` rides along in list responses: the metadata panel's
// "add a new field" name suggestions are built from names used across
// all entries.
const LIST_FIELDS =
  'e.id, e.title, e.summary, e.label, e.sublabel, e.tags, e.fields, e.created_at, e.updated_at';

function rowOut(row) {
  if (!row) return row;
  return {
    ...row,
    tags: JSON.parse(row.tags),
    fields: JSON.parse(row.fields),
    urls: row.urls !== undefined ? JSON.parse(row.urls) : undefined,
  };
}

router.get('/', (req, res) => {
  const { q, tag, label } = req.query;
  const conds = [];
  const params = [];

  if (typeof tag === 'string' && tag.trim()) {
    conds.push('EXISTS (SELECT 1 FROM json_each(e.tags) je WHERE lower(je.value) = lower(?))');
    params.push(tag.trim());
  }
  if (typeof label === 'string' && label.trim()) {
    conds.push('e.label = ?');
    params.push(label.trim());
  }

  let sql;
  const match = typeof q === 'string' ? ftsQuery(q) : null;
  if (match) {
    sql = `SELECT ${LIST_FIELDS} FROM entries_fts f JOIN entries e ON e.id = f.rowid
           WHERE entries_fts MATCH ?${conds.length ? ' AND ' + conds.join(' AND ') : ''}
           ORDER BY rank`;
    params.unshift(match);
  } else {
    sql = `SELECT ${LIST_FIELDS} FROM entries e
           ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
           ORDER BY e.updated_at DESC`;
  }

  const rows = db.prepare(sql).all(...params)
    .map((r) => ({ ...r, tags: JSON.parse(r.tags), fields: JSON.parse(r.fields) }));
  res.json({ entries: rows });
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM entries WHERE id = ?').get(req.params.id);
  if (!row) return sendError(res, 404, 'NOT_FOUND', 'Entry not found');
  res.json({ entry: rowOut(row) });
});

router.post('/', (req, res) => {
  const data = normalizeEntry(req.body);
  const now = Date.now();
  // created_at is always "now" (immutable thereafter); updated_at may be a
  // user-supplied modified time, else now.
  const updated_at = optTimestamp(req.body.updated_at, 'updated_at') ?? now;
  const info = db
    .prepare(
      `INSERT INTO entries (title, body_md, summary, label, sublabel, tags, fields, urls, created_at, updated_at)
       VALUES (@title, @body_md, @summary, @label, @sublabel, @tags, @fields, @urls, @created_at, @updated_at)`
    )
    .run({ ...data, created_at: now, updated_at });
  const row = db.prepare('SELECT * FROM entries WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ entry: rowOut(row) });
});

router.put('/:id', (req, res) => {
  const expected = expectedUpdatedAt(req.body);
  const data = normalizeEntry(req.body);
  const now = Date.now();
  // Manually-set modified time wins; otherwise bump to now. created_at is
  // never in the UPDATE — it stays immutable (and the DB trigger enforces it).
  const updated_at = optTimestamp(req.body.updated_at, 'updated_at') ?? now;

  const result = db.transaction(() => {
    const current = db.prepare('SELECT * FROM entries WHERE id = ?').get(req.params.id);
    if (!current) return { status: 404 };
    if (current.updated_at !== expected) return { status: 409, current };
    db.prepare(
      `UPDATE entries SET title=@title, body_md=@body_md, summary=@summary, label=@label,
       sublabel=@sublabel, tags=@tags, fields=@fields, urls=@urls,
       updated_at=@updated_at WHERE id=@id`
    ).run({ ...data, updated_at, id: current.id });
    return { status: 200, row: db.prepare('SELECT * FROM entries WHERE id = ?').get(current.id) };
  })();

  if (result.status === 404) return sendError(res, 404, 'NOT_FOUND', 'Entry not found — it may have been deleted on another device');
  if (result.status === 409) {
    return res.status(409).json({
      error: { code: 'CONFLICT', message: 'Entry was saved on another device' },
      entry: rowOut(result.current),
    });
  }
  res.json({ entry: rowOut(result.row) });
});

router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM entries WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return sendError(res, 404, 'NOT_FOUND', 'Entry not found');
  res.json({ ok: true });
});

module.exports = router;

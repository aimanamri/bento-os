'use strict';

const express = require('express');
const { db } = require('../db');
const { ValidationError } = require('../validate');
const { sendError } = require('../errors');

const router = express.Router();

// Client reads the file with FileReader and posts { filename, content }.
// The filename is used only for the fallback title — never as a path
// (SECURITY.md §4: title comes from content, path traversal is moot).

const MAX_CONTENT = 2 * 1024 * 1024;

router.post('/', (req, res) => {
  const { filename, content } = req.body || {};

  if (typeof content !== 'string' || typeof filename !== 'string') {
    return sendError(res, 400, 'VALIDATION', 'filename and content are required');
  }
  if (content.length > MAX_CONTENT) {
    return sendError(res, 413, 'TOO_LARGE', 'Markdown files are limited to 2 MB');
  }
  if (!/\.(md|markdown)$/i.test(filename)) {
    return sendError(res, 400, 'BAD_TYPE', 'Only .md or .markdown files can be imported');
  }
  // Binary renamed .md: NUL bytes, or mostly replacement chars from a bad decode
  if (content.includes('\u0000')) {
    return sendError(res, 400, 'BAD_TYPE', 'This file is not a markdown text file');
  }
  const replacements = (content.match(/�/g) || []).length;
  if (content.length > 0 && replacements / content.length > 0.05) {
    return sendError(res, 400, 'BAD_TYPE', 'This file is not valid UTF-8 text');
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

  const now = Date.now();
  const info = db
    .prepare(
      `INSERT INTO entries (title, body_md, summary, label, tags, urls, created_at, updated_at)
       VALUES (?, ?, '', 'Uncategorized', '[]', '[]', ?, ?)`
    )
    .run(title, text, now, now);

  const row = db.prepare('SELECT * FROM entries WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({
    entry: { ...row, tags: JSON.parse(row.tags), urls: JSON.parse(row.urls), fields: JSON.parse(row.fields) },
  });
});

module.exports = router;

-- Dynamic user-defined metadata fields (TiddlyWiki-style key/value rows).
-- Replaces the hardcoded platform / is_valid columns; per user decision the
-- old values are dropped, not migrated.

ALTER TABLE entries ADD COLUMN fields TEXT NOT NULL DEFAULT '{}';
ALTER TABLE entries DROP COLUMN platform;
ALTER TABLE entries DROP COLUMN is_valid;

-- FTS5 tables can't gain columns via ALTER — rebuild with `fields` indexed
-- so field names/values are searchable from the sidebar.
DROP TRIGGER entries_fts_ai;
DROP TRIGGER entries_fts_ad;
DROP TRIGGER entries_fts_au;
DROP TABLE entries_fts;

CREATE VIRTUAL TABLE entries_fts USING fts5(
  title, tags, summary, body_md, fields,
  content='entries', content_rowid='id', tokenize='porter unicode61'
);

CREATE TRIGGER entries_fts_ai AFTER INSERT ON entries BEGIN
  INSERT INTO entries_fts(rowid, title, tags, summary, body_md, fields)
  VALUES (new.id, new.title, new.tags, new.summary, new.body_md, new.fields);
END;

CREATE TRIGGER entries_fts_ad AFTER DELETE ON entries BEGIN
  INSERT INTO entries_fts(entries_fts, rowid, title, tags, summary, body_md, fields)
  VALUES ('delete', old.id, old.title, old.tags, old.summary, old.body_md, old.fields);
END;

CREATE TRIGGER entries_fts_au AFTER UPDATE ON entries BEGIN
  INSERT INTO entries_fts(entries_fts, rowid, title, tags, summary, body_md, fields)
  VALUES ('delete', old.id, old.title, old.tags, old.summary, old.body_md, old.fields);
  INSERT INTO entries_fts(rowid, title, tags, summary, body_md, fields)
  VALUES (new.id, new.title, new.tags, new.summary, new.body_md, new.fields);
END;

-- Repopulate the index from the content table
INSERT INTO entries_fts(entries_fts) VALUES('rebuild');

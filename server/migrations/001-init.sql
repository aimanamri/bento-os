CREATE TABLE entries (
  id          INTEGER PRIMARY KEY,
  title       TEXT    NOT NULL CHECK (length(trim(title)) > 0),
  body_md     TEXT    NOT NULL CHECK (length(trim(body_md)) > 0),
  summary     TEXT    NOT NULL DEFAULT '',
  label       TEXT    NOT NULL DEFAULT 'Uncategorized',
  sublabel    TEXT    DEFAULT NULL,
  tags        TEXT    NOT NULL DEFAULT '[]',
  platform    TEXT    DEFAULT NULL,
  is_valid    INTEGER NOT NULL DEFAULT 1,
  urls        TEXT    NOT NULL DEFAULT '[]',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TRIGGER entries_created_at_immutable
BEFORE UPDATE OF created_at ON entries
WHEN new.created_at != old.created_at
BEGIN
  SELECT RAISE(ABORT, 'created_at is immutable');
END;

CREATE TABLE prompts (
  id             INTEGER PRIMARY KEY,
  title          TEXT    NOT NULL CHECK (length(trim(title)) > 0),
  category       TEXT    NOT NULL DEFAULT 'GENERAL',
  body           TEXT    NOT NULL CHECK (length(trim(body)) > 0),
  why_this_works TEXT    NOT NULL DEFAULT '',
  tags           TEXT    NOT NULL DEFAULT '[]',
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE VIRTUAL TABLE entries_fts USING fts5(
  title, tags, summary, body_md,
  content='entries', content_rowid='id', tokenize='porter unicode61'
);

CREATE TRIGGER entries_fts_ai AFTER INSERT ON entries BEGIN
  INSERT INTO entries_fts(rowid, title, tags, summary, body_md)
  VALUES (new.id, new.title, new.tags, new.summary, new.body_md);
END;

CREATE TRIGGER entries_fts_ad AFTER DELETE ON entries BEGIN
  INSERT INTO entries_fts(entries_fts, rowid, title, tags, summary, body_md)
  VALUES ('delete', old.id, old.title, old.tags, old.summary, old.body_md);
END;

CREATE TRIGGER entries_fts_au AFTER UPDATE ON entries BEGIN
  INSERT INTO entries_fts(entries_fts, rowid, title, tags, summary, body_md)
  VALUES ('delete', old.id, old.title, old.tags, old.summary, old.body_md);
  INSERT INTO entries_fts(rowid, title, tags, summary, body_md)
  VALUES (new.id, new.title, new.tags, new.summary, new.body_md);
END;

CREATE VIRTUAL TABLE prompts_fts USING fts5(
  title, tags, category, body,
  content='prompts', content_rowid='id', tokenize='porter unicode61'
);

CREATE TRIGGER prompts_fts_ai AFTER INSERT ON prompts BEGIN
  INSERT INTO prompts_fts(rowid, title, tags, category, body)
  VALUES (new.id, new.title, new.tags, new.category, new.body);
END;

CREATE TRIGGER prompts_fts_ad AFTER DELETE ON prompts BEGIN
  INSERT INTO prompts_fts(prompts_fts, rowid, title, tags, category, body)
  VALUES ('delete', old.id, old.title, old.tags, old.category, old.body);
END;

CREATE TRIGGER prompts_fts_au AFTER UPDATE ON prompts BEGIN
  INSERT INTO prompts_fts(prompts_fts, rowid, title, tags, category, body)
  VALUES ('delete', old.id, old.title, old.tags, old.category, old.body);
  INSERT INTO prompts_fts(rowid, title, tags, category, body)
  VALUES (new.id, new.title, new.tags, new.category, new.body);
END;

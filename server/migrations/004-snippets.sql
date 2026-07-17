-- Code Snippets tab: reusable terminal/CLI command templates with the same
-- {{Variable}} fill-in engine as the Prompt Library. Mirrors the `prompts`
-- table, with `category` doubling as the language/tool label and `notes` in
-- place of `why_this_works`.
--
-- Unlike entries/prompts (which predate auth and needed the ALTER + sentinel
-- workaround in 003-auth.sql), `snippets` is created after `users` exists, so
-- it carries a real FK with ON DELETE CASCADE from the start — no backfill and
-- no user_id immutability trigger required.

CREATE TABLE snippets (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT    NOT NULL CHECK (length(trim(title)) > 0),
  category    TEXT    NOT NULL DEFAULT 'GENERAL',
  body        TEXT    NOT NULL CHECK (length(trim(body)) > 0),
  notes       TEXT    NOT NULL DEFAULT '',
  tags        TEXT    NOT NULL DEFAULT '[]',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX snippets_user_idx ON snippets(user_id, category, title);

-- `notes` is deliberately not indexed, matching prompts_fts (which omits
-- why_this_works): search stays scoped to title/tags/category/body.
CREATE VIRTUAL TABLE snippets_fts USING fts5(
  title, tags, category, body,
  content='snippets', content_rowid='id', tokenize='porter unicode61'
);

CREATE TRIGGER snippets_fts_ai AFTER INSERT ON snippets BEGIN
  INSERT INTO snippets_fts(rowid, title, tags, category, body)
  VALUES (new.id, new.title, new.tags, new.category, new.body);
END;

CREATE TRIGGER snippets_fts_ad AFTER DELETE ON snippets BEGIN
  INSERT INTO snippets_fts(snippets_fts, rowid, title, tags, category, body)
  VALUES ('delete', old.id, old.title, old.tags, old.category, old.body);
END;

CREATE TRIGGER snippets_fts_au AFTER UPDATE ON snippets BEGIN
  INSERT INTO snippets_fts(snippets_fts, rowid, title, tags, category, body)
  VALUES ('delete', old.id, old.title, old.tags, old.category, old.body);
  INSERT INTO snippets_fts(rowid, title, tags, category, body)
  VALUES (new.id, new.title, new.tags, new.category, new.body);
END;

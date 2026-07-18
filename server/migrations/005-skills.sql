-- Skills tab (SCHEMA_VERSION 5): a curated, admin-maintained catalog of agent
-- skills (vercel-labs/skills ecosystem), per-user install tracking, and a
-- server-only cache of fetched SKILL.md content. Mirrors the Supabase
-- variant's 20260718000002_skills.sql, translated to SQLite.
--
-- Unlike entries/prompts/snippets, skill_catalog is SHARED, not personal
-- content: every authenticated user can read it, but only the server (via
-- the seed below) ever writes it — there is no admin-write route yet.

CREATE TABLE skill_catalog (
  id              INTEGER PRIMARY KEY,
  name            TEXT    NOT NULL UNIQUE,
  description     TEXT    NOT NULL DEFAULT '',
  owner           TEXT    NOT NULL,
  repo            TEXT    NOT NULL,
  skill_path      TEXT    NOT NULL,
  category        TEXT    NOT NULL DEFAULT 'GENERAL',
  install_command TEXT    NOT NULL,
  tags            TEXT    NOT NULL DEFAULT '[]',
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  UNIQUE (owner, repo, skill_path)
);

-- Per-user "I've installed this" tracking — owner-only, like entries/prompts.
-- installed_sha records the upstream tree SHA at the moment of marking
-- installed; update_available is computed by comparing it against
-- skill_cache.upstream_sha.
CREATE TABLE user_skills (
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_id      INTEGER NOT NULL REFERENCES skill_catalog(id) ON DELETE CASCADE,
  installed_sha TEXT,
  installed_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, skill_id)
);

-- Server-fetched SKILL.md content, cached to respect GitHub's unauthenticated
-- rate limit (60 req/hr/IP). Only server/routes/skills.js ever writes it.
CREATE TABLE skill_cache (
  skill_id     INTEGER PRIMARY KEY REFERENCES skill_catalog(id) ON DELETE CASCADE,
  skill_md     TEXT    NOT NULL DEFAULT '',
  upstream_sha TEXT,
  etag         TEXT,
  fetched_at   INTEGER NOT NULL DEFAULT 0
);

-- Verified catalog seed (12 skills; paths confirmed against live repos — see
-- the implementation plan's "Verified external facts" table). Timestamps use
-- strftime('%s','now')*1000 in place of Postgres's extract(epoch from now()).
INSERT INTO skill_catalog
  (name, description, owner, repo, skill_path, category, install_command, tags, created_at, updated_at)
VALUES
  ('pdf', 'Read, fill, and edit PDF documents, including forms and merged/split pages.',
   'anthropics', 'skills', 'skills/pdf', 'DOCUMENTS',
   'npx skills add anthropics/skills --skill pdf', '["pdf","documents"]',
   strftime('%s','now')*1000, strftime('%s','now')*1000),

  ('docx', 'Create and edit Word documents with formatting, tables, and images.',
   'anthropics', 'skills', 'skills/docx', 'DOCUMENTS',
   'npx skills add anthropics/skills --skill docx', '["docx","documents"]',
   strftime('%s','now')*1000, strftime('%s','now')*1000),

  ('pptx', 'Build and edit PowerPoint presentations, slide by slide.',
   'anthropics', 'skills', 'skills/pptx', 'DOCUMENTS',
   'npx skills add anthropics/skills --skill pptx', '["pptx","documents"]',
   strftime('%s','now')*1000, strftime('%s','now')*1000),

  ('xlsx', 'Read, write, and analyze Excel spreadsheets, including formulas.',
   'anthropics', 'skills', 'skills/xlsx', 'DOCUMENTS',
   'npx skills add anthropics/skills --skill xlsx', '["xlsx","documents"]',
   strftime('%s','now')*1000, strftime('%s','now')*1000),

  ('skill-creator', 'Scaffold and package new agent skills, including SKILL.md and metadata.',
   'anthropics', 'skills', 'skills/skill-creator', 'META',
   'npx skills add anthropics/skills --skill skill-creator', '["meta","authoring"]',
   strftime('%s','now')*1000, strftime('%s','now')*1000),

  ('mcp-builder', 'Build Model Context Protocol servers and tools from a spec.',
   'anthropics', 'skills', 'skills/mcp-builder', 'DEV',
   'npx skills add anthropics/skills --skill mcp-builder', '["mcp","dev"]',
   strftime('%s','now')*1000, strftime('%s','now')*1000),

  ('webapp-testing', 'Drive and verify web apps end-to-end with a real browser.',
   'anthropics', 'skills', 'skills/webapp-testing', 'DEV',
   'npx skills add anthropics/skills --skill webapp-testing', '["testing","dev"]',
   strftime('%s','now')*1000, strftime('%s','now')*1000),

  ('frontend-design', 'Aesthetic direction and typography for building distinctive frontend UI.',
   'anthropics', 'skills', 'skills/frontend-design', 'DESIGN',
   'npx skills add anthropics/skills --skill frontend-design', '["design","frontend"]',
   strftime('%s','now')*1000, strftime('%s','now')*1000),

  ('react-best-practices', 'Idiomatic React patterns: hooks, composition, and performance.',
   'vercel-labs', 'agent-skills', 'skills/react-best-practices', 'DEV',
   'npx skills add vercel-labs/agent-skills --skill react-best-practices', '["react","dev"]',
   strftime('%s','now')*1000, strftime('%s','now')*1000),

  ('web-design-guidelines', 'Practical web design guidelines for layout, spacing, and color.',
   'vercel-labs', 'agent-skills', 'skills/web-design-guidelines', 'DESIGN',
   'npx skills add vercel-labs/agent-skills --skill web-design-guidelines', '["design","web"]',
   strftime('%s','now')*1000, strftime('%s','now')*1000),

  ('test-driven-development', 'Write the failing test first, then the minimal code to pass it.',
   'obra', 'superpowers', 'skills/test-driven-development', 'WORKFLOW',
   'npx skills add obra/superpowers --skill test-driven-development', '["tdd","workflow"]',
   strftime('%s','now')*1000, strftime('%s','now')*1000),

  ('systematic-debugging', 'A repeatable method for isolating and fixing hard bugs.',
   'obra', 'superpowers', 'skills/systematic-debugging', 'WORKFLOW',
   'npx skills add obra/superpowers --skill systematic-debugging', '["debugging","workflow"]',
   strftime('%s','now')*1000, strftime('%s','now')*1000);

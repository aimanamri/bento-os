-- Remove the Skills tab (SCHEMA_VERSION 6). Mirrors the Supabase variant's
-- 20260731000002_drop_skills.sql.
--
-- The curated agent-skill catalog added in 005-skills.sql was read-mostly
-- reference data duplicating what skills.sh already does, and none of the
-- content tools (entries / prompts / snippets) depend on it. The
-- /api/skills routes and server/routes/skills.js go with it.
--
-- Dropped in dependency order — user_skills and skill_cache both reference
-- skill_catalog. IF EXISTS keeps this a no-op on a database that somehow
-- never ran 005.

DROP TABLE IF EXISTS user_skills;
DROP TABLE IF EXISTS skill_cache;
DROP TABLE IF EXISTS skill_catalog;

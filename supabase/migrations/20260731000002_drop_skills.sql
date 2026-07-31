-- Bento OS — remove the Skills tab (schema v6).
--
-- The curated agent-skill catalog added in 20260718000002_skills.sql is gone
-- from the UI: it was read-mostly reference data that duplicated what
-- skills.sh already does well, and none of the personal-content tools
-- (entries / prompts / snippets) depend on it.
--
-- Dropping in dependency order — user_skills and skill_cache both reference
-- skill_catalog — removes their RLS policies with them. The `skills-proxy`
-- Edge Function that wrote skill_cache is deleted alongside this migration.

drop table if exists public.user_skills;
drop table if exists public.skill_cache;
drop table if exists public.skill_catalog;

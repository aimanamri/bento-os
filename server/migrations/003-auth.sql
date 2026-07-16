-- Multi-user auth + RBAC (SCHEMA_VERSION 3, local variant).
-- Adds identity/session/rate-limit tables and a per-user owner column on the
-- two content tables. See docs/DATABASE-LOCAL.md and docs/IMPLEMENTATION-LOCAL.md.
--
-- The global-admin ROW and the one-time backfill of pre-existing rows are done
-- in server/db.js's seed step (they need a scrypt hash computed in JS); this
-- file only establishes schema.

-- ── identity ────────────────────────────────────────────────────
CREATE TABLE users (
  id                       INTEGER PRIMARY KEY,
  username                 TEXT    NOT NULL UNIQUE
                             CHECK (length(username) BETWEEN 2 AND 32),
  password_hash            TEXT    NOT NULL,        -- scrypt$N$r$p$salt$hash
  role                     TEXT    NOT NULL DEFAULT 'user'
                             CHECK (role IN ('global_admin','admin','user')),
  requires_password_change INTEGER NOT NULL DEFAULT 0,
  created_at               INTEGER NOT NULL,
  updated_at               INTEGER NOT NULL
);

-- At most ONE global admin (mirrors the Postgres one_global_admin index).
CREATE UNIQUE INDEX one_global_admin ON users(role) WHERE role = 'global_admin';

-- ── server-side sessions ────────────────────────────────────────
-- id = sha256(raw token); the raw token lives only in the httpOnly cookie,
-- so a DB leak can't be replayed as a live session.
CREATE TABLE sessions (
  id           TEXT    PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX sessions_user_idx    ON sessions(user_id);
CREATE INDEX sessions_expires_idx ON sessions(expires_at);

-- ── fixed-window rate limiter (survives restarts) ───────────────
CREATE TABLE rate_limits (
  key          TEXT    NOT NULL,   -- 'login:<username>' | 'login-ip:<ip>' | 'pw-reset:<admin id>'
  window_start INTEGER NOT NULL,   -- Unix ms, floored to the window
  count        INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (key, window_start)
);

-- ── per-user ownership on the content tables ────────────────────
-- DEFAULT 0 is a transient sentinel: server/db.js backfills existing rows to
-- the bootstrapped global admin immediately after this migration, before the
-- server accepts requests. The immutability triggers below deliberately allow
-- the one-time 0 -> real-id backfill, then lock ownership forever after.
ALTER TABLE entries ADD COLUMN user_id INTEGER NOT NULL DEFAULT 0
  REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE prompts ADD COLUMN user_id INTEGER NOT NULL DEFAULT 0
  REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX entries_user_idx ON entries(user_id, updated_at DESC);
CREATE INDEX prompts_user_idx ON prompts(user_id, category, title);

CREATE TRIGGER entries_user_id_immutable
BEFORE UPDATE OF user_id ON entries
WHEN old.user_id != 0 AND new.user_id != old.user_id
BEGIN
  SELECT RAISE(ABORT, 'user_id is immutable');
END;

CREATE TRIGGER prompts_user_id_immutable
BEFORE UPDATE OF user_id ON prompts
WHEN old.user_id != 0 AND new.user_id != old.user_id
BEGIN
  SELECT RAISE(ABORT, 'user_id is immutable');
END;

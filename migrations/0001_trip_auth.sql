PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS travel_users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL UNIQUE,
  pin_salt TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  recovery_hashes TEXT NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS travel_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  user_agent_hash TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES travel_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS travel_sessions_user_id_idx ON travel_sessions(user_id);
CREATE INDEX IF NOT EXISTS travel_sessions_expires_at_idx ON travel_sessions(expires_at);

CREATE TABLE IF NOT EXISTS travel_login_attempts (
  attempt_key TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  window_started_at INTEGER NOT NULL,
  blocked_until INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS travel_state (
  state_key TEXT PRIMARY KEY,
  json_value TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS travel_activity_overrides (
  activity_id TEXT PRIMARY KEY,
  json_value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  FOREIGN KEY (updated_by) REFERENCES travel_users(id)
);

CREATE TABLE IF NOT EXISTS travel_documents (
  id TEXT PRIMARY KEY,
  r2_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  activity_id TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  FOREIGN KEY (created_by) REFERENCES travel_users(id)
);

-- People who have signed in. Owned by the identity module.
-- discord_id is the identity key: usernames change, snowflakes never do.
CREATE TABLE users (
  id            TEXT    PRIMARY KEY,
  discord_id    TEXT    NOT NULL UNIQUE,
  username      TEXT    NOT NULL,
  global_name   TEXT,
  avatar_hash   TEXT,
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER NOT NULL
) STRICT;

-- Only the SHA-256 of a session token is stored, never the token.
CREATE TABLE sessions (
  token_hash TEXT    PRIMARY KEY,
  user_id    TEXT    NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;

CREATE INDEX sessions_user_id ON sessions (user_id);
CREATE INDEX sessions_expires_at ON sessions (expires_at);

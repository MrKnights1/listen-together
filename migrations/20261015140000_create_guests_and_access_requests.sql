-- The guest list admins manage from /admin, and the people waiting to be let in.
-- A guest with is_admin may manage it too; the hosts in the server's
-- configuration always may, and are not stored here.
-- Owned by the identity module. Keyed by Discord id rather than users.id: a
-- guest can be let in before they have ever signed in, and a request comes
-- from somebody who has no user row at all.

CREATE TABLE guests (
  discord_id  TEXT    PRIMARY KEY,
  label       TEXT,
  avatar_hash TEXT,
  is_admin    INTEGER NOT NULL CHECK (is_admin IN (0, 1)),
  added_by    TEXT    NOT NULL,
  added_at    INTEGER NOT NULL
) STRICT;

-- Kept at most 30 days and at most 100 rows (see the identity domain).
CREATE TABLE access_requests (
  discord_id   TEXT    PRIMARY KEY,
  username     TEXT    NOT NULL,
  global_name  TEXT,
  avatar_hash  TEXT,
  requested_at INTEGER NOT NULL
) STRICT;

CREATE INDEX access_requests_requested_at ON access_requests (requested_at);

-- The metadata cache. Owned by the catalog module.
-- id is "<provider>:<provider_track_id>". No CHECK on provider: SQLite cannot
-- alter a CHECK, and adding a provider must not mean rebuilding this table.
-- Rows older than 30 days are refreshed or deleted (YouTube policy III.E.4).
CREATE TABLE tracks (
  id                TEXT    PRIMARY KEY,
  provider          TEXT    NOT NULL,
  provider_track_id TEXT    NOT NULL,
  title             TEXT    NOT NULL,
  artist            TEXT    NOT NULL,
  duration_ms       INTEGER NOT NULL CHECK (duration_ms >= 0),
  artwork_url       TEXT,
  unplayable_reason TEXT,
  fetched_at        INTEGER NOT NULL,
  UNIQUE (provider, provider_track_id)
) STRICT;

CREATE INDEX tracks_fetched_at ON tracks (fetched_at);

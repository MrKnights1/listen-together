-- The one room, owned by the room module, saved whole after every change.
-- state is the RoomState document (entries, lanes, rotation, clock) as JSON.
-- No foreign keys into users or tracks: those tables belong to other modules,
-- and the room tells the catalog which tracks it still uses instead.
CREATE TABLE room_state (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  state          TEXT    NOT NULL,
  saved_at       INTEGER NOT NULL,
  clean_shutdown INTEGER NOT NULL CHECK (clean_shutdown IN (0, 1))
) STRICT;

-- Who did what, for the room's feed. Kept 30 days.
CREATE TABLE activity (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  at       INTEGER NOT NULL,
  actor_id TEXT,
  kind     TEXT    NOT NULL,
  detail   TEXT    NOT NULL
) STRICT;

CREATE INDEX activity_at ON activity (at);

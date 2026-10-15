import type { Database } from "bun:sqlite";
import type { RoomRepository, StoredRoom } from "@/modules/room/domain/ports/RoomRepository.ts";
import type { RoomState } from "@/modules/room/domain/RoomState.ts";

interface RoomRow {
  state: string;
  saved_at: number;
  clean_shutdown: number;
}

/**
 * The room as one JSON document in one row. The room is a single aggregate
 * that changes as a whole and is read whole at boot; a row per entry would buy
 * nothing but a reassembly step and a way for the two to disagree. A full
 * room of 5000 songs is about a megabyte, written once per command.
 */
export class SqliteRoomRepository implements RoomRepository {
  constructor(private readonly db: Database) {}

  async load(): Promise<StoredRoom | null> {
    const row = this.db
      .query<RoomRow, []>("SELECT state, saved_at, clean_shutdown FROM room_state WHERE id = 1")
      .get();
    if (row === null) return null;

    return {
      state: parseRoomState(row.state),
      savedAt: row.saved_at,
      cleanShutdown: row.clean_shutdown === 1,
    };
  }

  async save(state: RoomState, savedAt: number, cleanShutdown: boolean): Promise<void> {
    this.db
      .query(
        `INSERT INTO room_state (id, state, saved_at, clean_shutdown) VALUES (1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           state          = excluded.state,
           saved_at       = excluded.saved_at,
           clean_shutdown = excluded.clean_shutdown`,
      )
      .run(JSON.stringify(state), savedAt, cleanShutdown ? 1 : 0);
  }
}

/**
 * Checks the stored document has the room's shape. Only this server ever
 * wrote it, so a mismatch means a bug or a hand edit — and booting into a
 * half-read room would be worse than refusing to boot with a clear message.
 */
function parseRoomState(json: string): RoomState {
  const value: unknown = JSON.parse(json);
  if (!isRecord(value)) throw notTheRoom();

  const queue: unknown[] = Array.isArray(value["queue"])
    ? (value["queue"] as unknown[])
    : fromTurns(value);
  // A room saved before shuffle became a switch had no such switch: it was off.
  const shuffle = "shuffle" in value ? value["shuffle"] : false;
  if (
    typeof shuffle !== "boolean" ||
    typeof value["version"] !== "number" ||
    !isRecord(value["entries"]) ||
    !queue.every((entryId): entryId is string => typeof entryId === "string") ||
    !(value["current"] === null || isRecord(value["current"])) ||
    !["off", "one", "all"].includes(value["repeat"] as string)
  ) {
    throw notTheRoom();
  }

  return {
    version: value["version"],
    entries: value["entries"] as RoomState["entries"],
    queue,
    current: value["current"] as RoomState["current"],
    repeat: value["repeat"] as RoomState["repeat"],
    shuffle,
  };
}

const isRecord = (candidate: unknown): candidate is Record<string, unknown> =>
  typeof candidate === "object" && candidate !== null && !Array.isArray(candidate);

const notTheRoom = () =>
  new Error("The saved room is not in the expected shape; refusing to start with it.");

/**
 * A room saved while songs still took turns between people kept one list per
 * person. Read once, the first time the server boots after the change: its
 * songs line up in the order they were added, and each person's list keeps its
 * own order where songs were added together. The next save writes the queue.
 */
function fromTurns(value: Record<string, unknown>): unknown[] {
  const lanes = value["lanes"];
  const entries = value["entries"];
  if (!isRecord(lanes) || !isRecord(entries)) throw notTheRoom();

  const addedAt = (entryId: unknown): number => {
    const entry = typeof entryId === "string" ? entries[entryId] : undefined;
    return isRecord(entry) && typeof entry["addedAt"] === "number" ? entry["addedAt"] : 0;
  };
  // Array.prototype.sort is stable, so songs added at the same moment keep their list order.
  return Object.values(lanes)
    .flatMap((lane) => (Array.isArray(lane) ? (lane as unknown[]) : []))
    .sort((a, b) => addedAt(a) - addedAt(b));
}

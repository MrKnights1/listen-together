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
 * room is about a hundred kilobytes, written once per command.
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
  const record = (candidate: unknown): candidate is Record<string, unknown> =>
    typeof candidate === "object" && candidate !== null && !Array.isArray(candidate);

  if (
    !record(value) ||
    typeof value["version"] !== "number" ||
    typeof value["counter"] !== "number" ||
    !record(value["entries"]) ||
    !record(value["lanes"]) ||
    !record(value["keys"]) ||
    !(value["current"] === null || record(value["current"])) ||
    !["off", "one", "all"].includes(value["repeat"] as string)
  ) {
    throw new Error("The saved room is not in the expected shape; refusing to start with it.");
  }

  return value as unknown as RoomState;
}

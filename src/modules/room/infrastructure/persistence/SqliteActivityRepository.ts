import type { Database } from "bun:sqlite";
import type {
  ActivityDetail,
  ActivityEntry,
  ActivityKind,
  NewActivity,
} from "@/modules/room/domain/activity.ts";
import type { ActivityRepository } from "@/modules/room/domain/ports/ActivityRepository.ts";

interface ActivityRow {
  id: number;
  at: number;
  actor_id: string | null;
  kind: string;
  detail: string;
}

export class SqliteActivityRepository implements ActivityRepository {
  constructor(private readonly db: Database) {}

  async record(activity: NewActivity): Promise<ActivityEntry> {
    const row = this.db
      .query<ActivityRow, [number, string | null, string, string]>(
        "INSERT INTO activity (at, actor_id, kind, detail) VALUES (?, ?, ?, ?) RETURNING *",
      )
      .get(activity.at, activity.actorId, activity.kind, JSON.stringify(activity.detail));

    if (row === null) throw new Error("Recording activity returned no row.");
    return toEntry(row);
  }

  async recent(limit: number): Promise<ActivityEntry[]> {
    return this.db
      .query<ActivityRow, [number]>("SELECT * FROM activity ORDER BY id DESC LIMIT ?")
      .all(limit)
      .map(toEntry)
      .reverse();
  }

  async purgeBefore(cutoff: number): Promise<number> {
    return this.db.query("DELETE FROM activity WHERE at < ?").run(cutoff).changes;
  }
}

function toEntry(row: ActivityRow): ActivityEntry {
  return {
    id: row.id,
    at: row.at,
    actorId: row.actor_id,
    kind: row.kind as ActivityKind,
    detail: JSON.parse(row.detail) as ActivityDetail,
  };
}

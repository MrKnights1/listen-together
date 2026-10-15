import type { Database } from "bun:sqlite";
import {
  MAX_ACCESS_REQUESTS,
  type AccessRequest,
} from "@/modules/identity/domain/AccessRequest.ts";
import type { AccessRequestRepository } from "@/modules/identity/domain/ports/AccessRequestRepository.ts";

interface AccessRequestRow {
  discord_id: string;
  username: string;
  global_name: string | null;
  avatar_hash: string | null;
  requested_at: number;
}

function toRequest(row: AccessRequestRow): AccessRequest {
  return {
    discordId: row.discord_id,
    username: row.username,
    globalName: row.global_name,
    avatarHash: row.avatar_hash,
    requestedAt: new Date(row.requested_at),
  };
}

export class SqliteAccessRequestRepository implements AccessRequestRepository {
  constructor(private readonly db: Database) {}

  async record(request: AccessRequest): Promise<void> {
    this.db.transaction(() => {
      this.db
        .query(
          `INSERT INTO access_requests (discord_id, username, global_name, avatar_hash, requested_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (discord_id) DO UPDATE SET
             username = excluded.username,
             global_name = excluded.global_name,
             avatar_hash = excluded.avatar_hash,
             requested_at = excluded.requested_at`,
        )
        .run(
          request.discordId,
          request.username,
          request.globalName,
          request.avatarHash,
          request.requestedAt.getTime(),
        );
      this.db
        .query(
          `DELETE FROM access_requests WHERE discord_id NOT IN (
             SELECT discord_id FROM access_requests ORDER BY requested_at DESC, discord_id LIMIT ?
           )`,
        )
        .run(MAX_ACCESS_REQUESTS);
    })();
  }

  async find(discordId: string): Promise<AccessRequest | null> {
    const row = this.db
      .query<AccessRequestRow, [string]>("SELECT * FROM access_requests WHERE discord_id = ?")
      .get(discordId);
    return row === null ? null : toRequest(row);
  }

  async list(): Promise<AccessRequest[]> {
    return this.db
      .query<AccessRequestRow, []>(
        "SELECT * FROM access_requests ORDER BY requested_at DESC, discord_id",
      )
      .all()
      .map(toRequest);
  }

  async remove(discordId: string): Promise<boolean> {
    return (
      this.db.query("DELETE FROM access_requests WHERE discord_id = ?").run(discordId).changes > 0
    );
  }

  async purgeBefore(cutoff: Date): Promise<number> {
    return this.db.query("DELETE FROM access_requests WHERE requested_at < ?").run(cutoff.getTime())
      .changes;
  }
}

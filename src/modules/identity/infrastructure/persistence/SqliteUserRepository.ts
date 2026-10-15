import type { Database } from "bun:sqlite";
import { User } from "@/modules/identity/domain/User.ts";
import type { UserRepository } from "@/modules/identity/domain/ports/UserRepository.ts";

interface UserRow {
  id: string;
  discord_id: string;
  username: string;
  global_name: string | null;
  avatar_hash: string | null;
  created_at: number;
  last_login_at: number;
}

export class SqliteUserRepository implements UserRepository {
  constructor(private readonly db: Database) {}

  async findById(id: string): Promise<User | null> {
    const row = this.db.query<UserRow, [string]>("SELECT * FROM users WHERE id = ?").get(id);
    return row === null ? null : toUser(row);
  }

  async findByIds(ids: string[]): Promise<User[]> {
    // No ids would build `IN ()`, which is a syntax error rather than an empty answer.
    if (ids.length === 0) return [];

    const placeholders = ids.map(() => "?").join(", ");

    return this.db
      .query<UserRow, string[]>(`SELECT * FROM users WHERE id IN (${placeholders})`)
      .all(...ids)
      .map(toUser);
  }

  async findByDiscordId(discordId: string): Promise<User | null> {
    const row = this.db
      .query<UserRow, [string]>("SELECT * FROM users WHERE discord_id = ?")
      .get(discordId);
    return row === null ? null : toUser(row);
  }

  /**
   * Upsert on `discord_id`, so a second sign-in proposing a fresh id updates
   * the existing row instead of hitting the UNIQUE constraint. `id` and
   * `created_at` are never updated, so RETURNING hands back whichever id got
   * there first.
   */
  async save(user: User): Promise<User> {
    const s = user.toSnapshot();
    const row = this.db
      .query<UserRow, [string, string, string, string | null, string | null, number, number]>(
        `INSERT INTO users (id, discord_id, username, global_name, avatar_hash, created_at, last_login_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(discord_id) DO UPDATE SET
           username      = excluded.username,
           global_name   = excluded.global_name,
           avatar_hash   = excluded.avatar_hash,
           last_login_at = excluded.last_login_at
         RETURNING *`,
      )
      .get(
        s.id,
        s.discordId,
        s.username,
        s.globalName,
        s.avatarHash,
        s.createdAt.getTime(),
        s.lastLoginAt.getTime(),
      );

    if (row === null) throw new Error(`Saving user ${s.id} returned no row.`);
    return toUser(row);
  }
}

function toUser(row: UserRow): User {
  return User.restore({
    id: row.id,
    discordId: row.discord_id,
    username: row.username,
    globalName: row.global_name,
    avatarHash: row.avatar_hash,
    createdAt: new Date(row.created_at),
    lastLoginAt: new Date(row.last_login_at),
  });
}

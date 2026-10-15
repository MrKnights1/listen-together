import type { Database } from "bun:sqlite";
import { Session } from "@/modules/identity/domain/Session.ts";
import type { SessionRepository } from "@/modules/identity/domain/ports/SessionRepository.ts";

interface SessionRow {
  token_hash: string;
  user_id: string;
  created_at: number;
  expires_at: number;
}

export class SqliteSessionRepository implements SessionRepository {
  constructor(private readonly db: Database) {}

  async save(session: Session): Promise<void> {
    const snapshot = session.toSnapshot();
    this.db
      .query(
        "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
      )
      .run(
        snapshot.tokenHash,
        snapshot.userId,
        snapshot.createdAt.getTime(),
        snapshot.expiresAt.getTime(),
      );
  }

  async findByTokenHash(tokenHash: string): Promise<Session | null> {
    const row = this.db
      .query<SessionRow, [string]>("SELECT * FROM sessions WHERE token_hash = ?")
      .get(tokenHash);

    return row === null
      ? null
      : Session.restore({
          tokenHash: row.token_hash,
          userId: row.user_id,
          createdAt: new Date(row.created_at),
          expiresAt: new Date(row.expires_at),
        });
  }

  async delete(tokenHash: string): Promise<void> {
    this.db.query("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
  }

  async deleteExpired(now: Date): Promise<number> {
    return this.db.query("DELETE FROM sessions WHERE expires_at <= ?").run(now.getTime()).changes;
  }

  async deleteByUserId(userId: string): Promise<number> {
    return this.db.query("DELETE FROM sessions WHERE user_id = ?").run(userId).changes;
  }
}

import type { Database } from "bun:sqlite";
import type { Guest } from "@/modules/identity/domain/Guest.ts";
import type { GuestRepository } from "@/modules/identity/domain/ports/GuestRepository.ts";

interface GuestRow {
  discord_id: string;
  label: string | null;
  avatar_hash: string | null;
  is_admin: number;
  added_by: string;
  added_at: number;
}

function toGuest(row: GuestRow): Guest {
  return {
    discordId: row.discord_id,
    label: row.label,
    avatarHash: row.avatar_hash,
    isAdmin: row.is_admin === 1,
    addedBy: row.added_by,
    addedAt: new Date(row.added_at),
  };
}

export class SqliteGuestRepository implements GuestRepository {
  constructor(private readonly db: Database) {}

  async find(discordId: string): Promise<Guest | null> {
    const row = this.db
      .query<GuestRow, [string]>("SELECT * FROM guests WHERE discord_id = ?")
      .get(discordId);
    return row === null ? null : toGuest(row);
  }

  async list(): Promise<Guest[]> {
    return this.db
      .query<GuestRow, []>("SELECT * FROM guests ORDER BY added_at DESC, discord_id")
      .all()
      .map(toGuest);
  }

  async add(guest: Guest): Promise<void> {
    this.db
      .query(
        "INSERT INTO guests (discord_id, label, avatar_hash, is_admin, added_by, added_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        guest.discordId,
        guest.label,
        guest.avatarHash,
        guest.isAdmin ? 1 : 0,
        guest.addedBy,
        guest.addedAt.getTime(),
      );
  }

  async setAdmin(discordId: string, isAdmin: boolean): Promise<boolean> {
    return (
      this.db
        .query("UPDATE guests SET is_admin = ? WHERE discord_id = ?")
        .run(isAdmin ? 1 : 0, discordId).changes > 0
    );
  }

  async remove(discordId: string): Promise<boolean> {
    return this.db.query("DELETE FROM guests WHERE discord_id = ?").run(discordId).changes > 0;
  }
}

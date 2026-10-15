import type { User } from "@/modules/identity/domain/User.ts";

export interface UserRepository {
  findById(id: string): Promise<User | null>;

  /**
   * The people behind a set of ids, in one read — the room shows who added
   * every queued song. Ids that match nothing are simply absent, so the answer
   * can be shorter than the question.
   */
  findByIds(ids: string[]): Promise<User[]>;
  findByDiscordId(discordId: string): Promise<User | null>;

  /**
   * Stores the user and returns the row as it now stands. The Discord account,
   * not the id, identifies a person, so two concurrent first sign-ins converge
   * on one row; the caller gets back whichever id won.
   */
  save(user: User): Promise<User>;
}

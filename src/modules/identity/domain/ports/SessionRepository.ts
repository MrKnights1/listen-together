import type { Session } from "@/modules/identity/domain/Session.ts";

export interface SessionRepository {
  save(session: Session): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<Session | null>;
  delete(tokenHash: string): Promise<void>;
  deleteExpired(now: Date): Promise<number>;
  /** Ends every session a user has; returns how many. */
  deleteByUserId(userId: string): Promise<number>;
}

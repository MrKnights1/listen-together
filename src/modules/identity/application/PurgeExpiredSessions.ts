import type { Clock } from "@/shared/domain/Clock.ts";
import type { SessionRepository } from "@/modules/identity/domain/ports/SessionRepository.ts";

/**
 * Deletes sessions past their expiry. Expired sessions are already refused on
 * lookup; this only stops abandoned ones from accumulating forever.
 */
export class PurgeExpiredSessions {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<number> {
    return await this.sessions.deleteExpired(this.clock.now());
  }
}

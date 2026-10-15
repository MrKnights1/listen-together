import type { SessionRepository } from "@/modules/identity/domain/ports/SessionRepository.ts";
import type { TokenGenerator } from "@/modules/identity/domain/ports/TokenGenerator.ts";

/**
 * Ends a session. The row is deleted rather than flagged, so a stolen cookie
 * is worthless the moment its owner signs out.
 */
export class LogOut {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly tokens: TokenGenerator,
  ) {}

  async execute(sessionToken: string | null): Promise<void> {
    if (sessionToken === null || sessionToken === "") return;
    await this.sessions.delete(this.tokens.hash(sessionToken));
  }
}

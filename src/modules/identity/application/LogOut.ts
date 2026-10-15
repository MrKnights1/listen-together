import type { SessionRepository } from "@/modules/identity/domain/ports/SessionRepository.ts";
import type { TokenGenerator } from "@/modules/identity/domain/ports/TokenGenerator.ts";

/** Told the raw token of a session that just ended, so whatever it opened can close. */
export type SessionEndedListener = (sessionToken: string) => void;

/**
 * Ends a session. The row is deleted rather than flagged, so a stolen cookie
 * is worthless the moment its owner signs out.
 *
 * Anything that outlives a request — an open socket — can ask to be told, so
 * signing out ends it at once rather than at its next command. Identity knows
 * nothing about who listens.
 */
export class LogOut {
  private readonly listeners = new Set<SessionEndedListener>();

  constructor(
    private readonly sessions: SessionRepository,
    private readonly tokens: TokenGenerator,
  ) {}

  onSessionEnded(listener: SessionEndedListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async execute(sessionToken: string | null): Promise<void> {
    if (sessionToken === null || sessionToken === "") return;
    await this.sessions.delete(this.tokens.hash(sessionToken));

    for (const listener of this.listeners) {
      try {
        listener(sessionToken);
      } catch (error) {
        // Signing out has already happened; a listener failing cannot undo it.
        console.error("A session-ended listener failed", error);
      }
    }
  }
}

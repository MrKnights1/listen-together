import type { Clock } from "@/shared/domain/Clock.ts";
import type { AllowedDiscordUsers } from "@/modules/identity/domain/AllowedDiscordUsers.ts";
import type { User } from "@/modules/identity/domain/User.ts";
import type { SessionRepository } from "@/modules/identity/domain/ports/SessionRepository.ts";
import type { TokenGenerator } from "@/modules/identity/domain/ports/TokenGenerator.ts";
import type { UserRepository } from "@/modules/identity/domain/ports/UserRepository.ts";

/**
 * Who is behind a session token. `not_allowed` is kept apart from `signed_out`
 * because the answers differ: signing in again fixes the second, never the
 * first.
 */
export type SessionLookup =
  | {
      status: "signed_in";
      user: User;
      /** When this session stops being valid — so a long-lived socket knows when to let go. */
      expiresAt: Date;
    }
  | { status: "signed_out" }
  | { status: "not_allowed" };

/**
 * The single place a request is decided to be authenticated.
 *
 * The whitelist is checked here as well as at sign-in, so taking somebody off
 * the list takes effect on their next request rather than in up to 30 days.
 * Their session is deleted on the way out: it can never become valid again.
 */
export class GetSessionUser {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly users: UserRepository,
    private readonly allowed: AllowedDiscordUsers,
    private readonly tokens: TokenGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(sessionToken: string | null): Promise<SessionLookup> {
    if (sessionToken === null || sessionToken === "") return { status: "signed_out" };

    const session = await this.sessions.findByTokenHash(this.tokens.hash(sessionToken));
    if (session === null) return { status: "signed_out" };

    if (session.isExpired(this.clock.now())) {
      await this.sessions.delete(session.tokenHash);
      return { status: "signed_out" };
    }

    const user = await this.users.findById(session.userId);
    if (user === null) return { status: "signed_out" };

    if (!this.allowed.allows(user.discordId)) {
      await this.sessions.delete(session.tokenHash);
      return { status: "not_allowed" };
    }

    return { status: "signed_in", user, expiresAt: session.expiresAt };
  }
}

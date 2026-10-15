import type { Clock } from "@/shared/domain/Clock.ts";
import type { IdGenerator } from "@/shared/domain/IdGenerator.ts";
import { DiscordIdentity } from "@/modules/identity/domain/DiscordIdentity.ts";
import { NotAllowed } from "@/modules/identity/domain/errors.ts";
import type { LoginRequest } from "@/modules/identity/domain/LoginRequest.ts";
import { Session } from "@/modules/identity/domain/Session.ts";
import { User } from "@/modules/identity/domain/User.ts";
import type { AccessRequestRepository } from "@/modules/identity/domain/ports/AccessRequestRepository.ts";
import type { DiscordOAuth } from "@/modules/identity/domain/ports/DiscordOAuth.ts";
import type { SessionRepository } from "@/modules/identity/domain/ports/SessionRepository.ts";
import type { TokenGenerator } from "@/modules/identity/domain/ports/TokenGenerator.ts";
import type { UserRepository } from "@/modules/identity/domain/ports/UserRepository.ts";
import type { AccessList } from "./AccessList.ts";

export interface CompletedLogin {
  user: User;
  session: Session;
  /** The raw token for the browser. Never stored, never logged. */
  sessionToken: string;
}

/**
 * Finishes a sign-in that Discord has redirected back.
 *
 * Order matters twice. The callback is proven to belong to this browser's
 * sign-in *before* the code is spent, so a forged callback never reaches
 * Discord. And the guest list is checked *before* a user or session is
 * written: a stranger who completes Discord's consent screen gets neither.
 * What they leave is a request to be let in — their Discord name and picture,
 * for a host to approve or decline.
 */
export class CompleteDiscordLogin {
  constructor(
    private readonly oauth: DiscordOAuth,
    private readonly access: AccessList,
    private readonly accessRequests: AccessRequestRepository,
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly tokens: TokenGenerator,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(
    loginRequest: LoginRequest,
    returnedState: string,
    code: string,
  ): Promise<CompletedLogin> {
    loginRequest.verify(returnedState, this.clock.now());

    const profile = await this.oauth.exchangeCode(code, loginRequest.codeVerifier);
    const identity = DiscordIdentity.fromProfile(profile);
    if (!(await this.access.allows(identity.discordId))) {
      await this.accessRequests.record({
        discordId: identity.discordId,
        username: identity.username,
        globalName: identity.globalName,
        avatarHash: identity.avatarHash,
        requestedAt: this.clock.now(),
      });
      throw new NotAllowed();
    }

    // Read again: the exchange is a network round trip.
    const now = this.clock.now();
    const existing = await this.users.findByDiscordId(identity.discordId);
    const candidate =
      existing === null
        ? User.register(this.ids.newId(), identity, now)
        : existing.signedInAgain(identity, now);

    // The saved user, not the proposed one: a concurrent first sign-in for the
    // same account may already have claimed the row under a different id.
    const user = await this.users.save(candidate);

    // A fresh token every sign-in, so a session handed out before login can
    // never become an authenticated one.
    const sessionToken = this.tokens.generate();
    const session = Session.open(this.tokens.hash(sessionToken), user.id, now);
    await this.sessions.save(session);

    return { user, session, sessionToken };
  }
}

import type { Clock } from "@/shared/domain/Clock.ts";
import { LoginRequest } from "@/modules/identity/domain/LoginRequest.ts";
import type { DiscordOAuth } from "@/modules/identity/domain/ports/DiscordOAuth.ts";
import type { TokenGenerator } from "@/modules/identity/domain/ports/TokenGenerator.ts";

export interface StartedLogin {
  authorizationUrl: string;
  loginRequest: LoginRequest;
}

/**
 * Begins a sign-in: mints the one-time values that tie the callback back to
 * this browser, and builds the URL to send it to.
 */
export class StartDiscordLogin {
  constructor(
    private readonly oauth: DiscordOAuth,
    private readonly tokens: TokenGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<StartedLogin> {
    const state = this.tokens.generate();
    const codeVerifier = this.tokens.generate();
    const loginRequest = LoginRequest.start(state, codeVerifier, this.clock.now());

    return {
      authorizationUrl: await this.oauth.authorizationUrl(state, codeVerifier),
      loginRequest,
    };
  }
}

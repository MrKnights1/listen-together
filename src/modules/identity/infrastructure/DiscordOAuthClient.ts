import type { DiscordProfile } from "@/modules/identity/domain/DiscordIdentity.ts";
import type { DiscordOAuth } from "@/modules/identity/domain/ports/DiscordOAuth.ts";

export interface DiscordEndpoints {
  authorize: string;
  token: string;
  revoke: string;
  currentUser: string;
}

/** https://docs.discord.com/developers/topics/oauth2 */
export const DISCORD_ENDPOINTS: DiscordEndpoints = {
  authorize: "https://discord.com/oauth2/authorize",
  token: "https://discord.com/api/oauth2/token",
  revoke: "https://discord.com/api/oauth2/token/revoke",
  currentUser: "https://discord.com/api/v10/users/@me",
};

export interface DiscordOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Injected so the adapter can be tested against a local stand-in for Discord. */
  endpoints: DiscordEndpoints;
}

/** A sign-in callback waits on these requests; a hung Discord must not hang it forever. */
const REQUEST_TIMEOUT_MS = 10_000;

interface TokenResponse {
  access_token?: unknown;
}

interface ProfileResponse {
  id?: unknown;
  username?: unknown;
  global_name?: unknown;
  avatar?: unknown;
}

export class DiscordOAuthClient implements DiscordOAuth {
  constructor(private readonly config: DiscordOAuthConfig) {}

  async authorizationUrl(state: string, codeVerifier: string): Promise<string> {
    const url = new URL(this.config.endpoints.authorize);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: this.config.clientId,
      // `identify` alone: id, username, display name and avatar. No email, no guilds.
      scope: "identify",
      redirect_uri: this.config.redirectUri,
      state,
      code_challenge: await deriveCodeChallenge(codeVerifier),
      code_challenge_method: "S256",
    }).toString();
    return url.toString();
  }

  async exchangeCode(code: string, codeVerifier: string): Promise<DiscordProfile> {
    const accessToken = await this.redeem(code, codeVerifier);

    try {
      return await this.fetchProfile(accessToken);
    } finally {
      // Everything needed is already in hand; holding the token would only be a liability.
      await this.revoke(accessToken);
    }
  }

  private async redeem(code: string, codeVerifier: string): Promise<string> {
    const response = await fetch(this.config.endpoints.token, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: this.basicAuthorization(),
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: this.config.redirectUri,
        code_verifier: codeVerifier,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      // The body is not logged: an OAuth error response can echo the request.
      throw new Error(`Discord rejected the authorization code (HTTP ${response.status}).`);
    }

    const body = (await response.json()) as TokenResponse;
    if (typeof body.access_token !== "string" || body.access_token === "") {
      throw new Error("Discord's token response contained no access token.");
    }
    return body.access_token;
  }

  private async fetchProfile(accessToken: string): Promise<DiscordProfile> {
    const response = await fetch(this.config.endpoints.currentUser, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Discord refused the profile request (HTTP ${response.status}).`);
    }

    const body = (await response.json()) as ProfileResponse;
    if (typeof body.id !== "string" || typeof body.username !== "string") {
      throw new Error("Discord's profile response is missing the id or username.");
    }

    return {
      id: body.id,
      username: body.username,
      globalName: typeof body.global_name === "string" ? body.global_name : null,
      avatarHash: typeof body.avatar === "string" ? body.avatar : null,
    };
  }

  /**
   * Best effort. A failed revocation must not fail a sign-in that has already
   * succeeded; the token expires on Discord's side regardless.
   */
  private async revoke(accessToken: string): Promise<void> {
    try {
      const response = await fetch(this.config.endpoints.revoke, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          authorization: this.basicAuthorization(),
        },
        body: new URLSearchParams({ token: accessToken, token_type_hint: "access_token" }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) console.warn(`Discord token revocation failed (HTTP ${response.status}).`);
    } catch (error) {
      console.warn("Discord token revocation failed", error instanceof Error ? error.name : "");
    }
  }

  /** RFC 6749 §2.3.1: both halves form-encoded before they are joined and base64'd. */
  private basicAuthorization(): string {
    const id = encodeURIComponent(this.config.clientId);
    const secret = encodeURIComponent(this.config.clientSecret);
    return `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
  }
}

/** PKCE S256: challenge = base64url(SHA-256(verifier)). */
async function deriveCodeChallenge(codeVerifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
  return Buffer.from(digest).toString("base64url");
}

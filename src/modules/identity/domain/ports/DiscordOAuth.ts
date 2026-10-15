import type { DiscordProfile } from "@/modules/identity/domain/DiscordIdentity.ts";

/**
 * The OAuth conversation with Discord, as the sign-in rules need to see it.
 * Endpoints, PKCE hashing, the profile request and token revocation live
 * behind this; no Discord token ever crosses it.
 */
export interface DiscordOAuth {
  authorizationUrl(state: string, codeVerifier: string): Promise<string>;
  /** Redeems the code, reads the profile, and lets go of Discord's token. */
  exchangeCode(code: string, codeVerifier: string): Promise<DiscordProfile>;
}

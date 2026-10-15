import { InvalidIdentity } from "./errors.ts";

/** What Discord's `GET /users/@me` returns under the `identify` scope, as far as we use it. */
export interface DiscordProfile {
  id: string;
  username: string;
  /** The display name a person chose on Discord. Null when they never set one. */
  globalName: string | null;
  avatarHash: string | null;
}

/** Discord user ids are snowflakes: 64-bit integers written in decimal. */
export const DISCORD_ID = /^\d{17,20}$/;

/**
 * A Discord account this application is willing to treat as an identity.
 *
 * The snowflake `id` is the identity key, not the username: usernames can be
 * changed and later taken by somebody else, the id never changes.
 */
export class DiscordIdentity {
  private constructor(
    readonly discordId: string,
    readonly username: string,
    readonly globalName: string | null,
    readonly avatarHash: string | null,
  ) {}

  static fromProfile(profile: DiscordProfile): DiscordIdentity {
    if (!DISCORD_ID.test(profile.id)) throw new InvalidIdentity("account id");

    const username = profile.username.trim();
    if (username === "") throw new InvalidIdentity("username");

    const globalName = profile.globalName?.trim() ?? "";

    return new DiscordIdentity(
      profile.id,
      username,
      globalName === "" ? null : globalName,
      profile.avatarHash,
    );
  }
}

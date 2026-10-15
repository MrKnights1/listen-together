const DISCORD_CDN = "https://cdn.discordapp.com";

/** Discord's own six default avatars, chosen from the id for accounts without one. */
const DEFAULT_AVATAR_COUNT = 6n;

/**
 * A Discord account's avatar, or one of Discord's default avatars when it has
 * none. The default index is `(id >> 22) % 6`, which needs BigInt: a snowflake
 * does not fit in a double.
 */
export function discordAvatarUrl(discordId: string, avatarHash: string | null): string {
  if (avatarHash !== null) {
    return `${DISCORD_CDN}/avatars/${discordId}/${avatarHash}.png?size=64`;
  }
  const index = (BigInt(discordId) >> 22n) % DEFAULT_AVATAR_COUNT;
  return `${DISCORD_CDN}/embed/avatars/${index}.png`;
}

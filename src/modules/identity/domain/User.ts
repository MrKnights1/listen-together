import type { DiscordIdentity } from "./DiscordIdentity.ts";

export interface UserSnapshot {
  id: string;
  discordId: string;
  username: string;
  globalName: string | null;
  avatarHash: string | null;
  createdAt: Date;
  lastLoginAt: Date;
}

const DISCORD_CDN = "https://cdn.discordapp.com";

/** Discord's own six default avatars, chosen from the id for accounts without one. */
const DEFAULT_AVATAR_COUNT = 6n;

export class User {
  private constructor(
    readonly id: string,
    readonly discordId: string,
    readonly username: string,
    readonly globalName: string | null,
    readonly avatarHash: string | null,
    readonly createdAt: Date,
    readonly lastLoginAt: Date,
  ) {}

  static register(id: string, identity: DiscordIdentity, now: Date): User {
    return new User(
      id,
      identity.discordId,
      identity.username,
      identity.globalName,
      identity.avatarHash,
      now,
      now,
    );
  }

  /** Rebuilds a user read from storage. No rules run — they ran on the way in. */
  static restore(snapshot: UserSnapshot): User {
    return new User(
      snapshot.id,
      snapshot.discordId,
      snapshot.username,
      snapshot.globalName,
      snapshot.avatarHash,
      snapshot.createdAt,
      snapshot.lastLoginAt,
    );
  }

  /**
   * Discord owns the name and the picture, and nothing here lets anyone change
   * them, so every sign-in takes them fresh. `id`, `discordId` and `createdAt`
   * are fixed for life.
   */
  signedInAgain(identity: DiscordIdentity, now: Date): User {
    return new User(
      this.id,
      this.discordId,
      identity.username,
      identity.globalName,
      identity.avatarHash,
      this.createdAt,
      now,
    );
  }

  /** What the room calls this person: their Discord display name, else their username. */
  get displayName(): string {
    return this.globalName ?? this.username;
  }

  /**
   * Their Discord avatar, or one of Discord's default avatars when they have
   * none. The default index is `(id >> 22) % 6`, which needs BigInt: a
   * snowflake does not fit in a double.
   */
  get avatarUrl(): string {
    if (this.avatarHash !== null) {
      return `${DISCORD_CDN}/avatars/${this.discordId}/${this.avatarHash}.png?size=64`;
    }
    const index = (BigInt(this.discordId) >> 22n) % DEFAULT_AVATAR_COUNT;
    return `${DISCORD_CDN}/embed/avatars/${index}.png`;
  }

  toSnapshot(): UserSnapshot {
    return {
      id: this.id,
      discordId: this.discordId,
      username: this.username,
      globalName: this.globalName,
      avatarHash: this.avatarHash,
      createdAt: this.createdAt,
      lastLoginAt: this.lastLoginAt,
    };
  }
}

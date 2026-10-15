import type { DiscordIdentity } from "./DiscordIdentity.ts";
import { discordAvatarUrl } from "./discordAvatar.ts";

export interface UserSnapshot {
  id: string;
  discordId: string;
  username: string;
  globalName: string | null;
  avatarHash: string | null;
  createdAt: Date;
  lastLoginAt: Date;
}

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

  /** Their Discord avatar, or Discord's default one for them. */
  get avatarUrl(): string {
    return discordAvatarUrl(this.discordId, this.avatarHash);
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

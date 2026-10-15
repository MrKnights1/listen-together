import { NotAllowed } from "./errors.ts";

/**
 * The guest list: Discord user ids that may sign in. Checked on every sign-in
 * *and* on every authenticated request, so taking somebody off the list ends
 * their access the next time they do anything, not when their session expires.
 */
export class AllowedDiscordUsers {
  private readonly ids: ReadonlySet<string>;

  private constructor(ids: Iterable<string>) {
    this.ids = new Set(ids);
  }

  static of(ids: Iterable<string>): AllowedDiscordUsers {
    return new AllowedDiscordUsers(ids);
  }

  allows(discordId: string): boolean {
    return this.ids.has(discordId);
  }

  /** Throws `NotAllowed` for anyone not on the list. */
  admit(discordId: string): void {
    if (!this.allows(discordId)) throw new NotAllowed();
  }
}

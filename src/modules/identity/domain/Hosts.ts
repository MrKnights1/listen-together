/**
 * The hosts: the Discord ids in the server's `DISCORD_ALLOWED_USER_IDS`. They
 * are always let in and are always admins. Set on the server, so nobody can be
 * made a host — or stop being one — from inside the app; the admin page can
 * only make guests admins.
 */
export class Hosts {
  private readonly ids: ReadonlySet<string>;

  private constructor(ids: Iterable<string>) {
    this.ids = new Set(ids);
  }

  static of(ids: Iterable<string>): Hosts {
    return new Hosts(ids);
  }

  includes(discordId: string): boolean {
    return this.ids.has(discordId);
  }

  /** In the order they were configured. */
  list(): string[] {
    return [...this.ids];
  }
}

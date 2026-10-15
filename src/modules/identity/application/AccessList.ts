import type { Hosts } from "@/modules/identity/domain/Hosts.ts";
import type { GuestRepository } from "@/modules/identity/domain/ports/GuestRepository.ts";

/**
 * Who may enter, and who may manage that: the hosts from the server's
 * configuration, and the guests let in from the admin page — some of whom are
 * admins too. Asked at every sign-in and on every authenticated request, so a
 * change takes effect at once.
 */
export class AccessList {
  constructor(
    private readonly hosts: Hosts,
    private readonly guests: GuestRepository,
  ) {}

  async isAdmin(discordId: string): Promise<boolean> {
    if (this.hosts.includes(discordId)) return true;
    return (await this.guests.find(discordId))?.isAdmin === true;
  }

  async allows(discordId: string): Promise<boolean> {
    return this.hosts.includes(discordId) || (await this.guests.find(discordId)) !== null;
  }
}

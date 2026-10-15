import type { Hosts } from "@/modules/identity/domain/Hosts.ts";
import type { GuestRepository } from "@/modules/identity/domain/ports/GuestRepository.ts";

export type SetGuestAdminOutcome = "updated" | "not_found" | "is_host";

/**
 * Makes a guest an admin, or a guest again. Hosts are admins by the server's
 * configuration and are not changed here. Taking the role away needs nothing
 * closed: the next admin request is simply refused.
 */
export class SetGuestAdmin {
  constructor(
    private readonly hosts: Hosts,
    private readonly guests: GuestRepository,
  ) {}

  async execute(discordId: string, isAdmin: boolean): Promise<SetGuestAdminOutcome> {
    if (this.hosts.includes(discordId)) return "is_host";
    return (await this.guests.setAdmin(discordId, isAdmin)) ? "updated" : "not_found";
  }
}

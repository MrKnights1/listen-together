import type { Clock } from "@/shared/domain/Clock.ts";
import type { Hosts } from "@/modules/identity/domain/Hosts.ts";
import { DISCORD_ID } from "@/modules/identity/domain/DiscordIdentity.ts";
import { GUEST_LABEL_MAX_LENGTH } from "@/modules/identity/domain/Guest.ts";
import type { AccessRequestRepository } from "@/modules/identity/domain/ports/AccessRequestRepository.ts";
import type { GuestRepository } from "@/modules/identity/domain/ports/GuestRepository.ts";

export type AddGuestOutcome =
  "added" | "invalid_id" | "invalid_label" | "already_host" | "already_guest";

/**
 * Lets somebody in: by approving their request, or by their Discord id typed
 * in by hand — the same thing, since a request is only a Discord id waiting.
 * A waiting request lends its Discord name and picture, then goes.
 */
export class AddGuest {
  constructor(
    private readonly hosts: Hosts,
    private readonly guests: GuestRepository,
    private readonly requests: AccessRequestRepository,
    private readonly clock: Clock,
  ) {}

  async execute(
    addedBy: string,
    discordId: string,
    label: string | null,
  ): Promise<AddGuestOutcome> {
    const id = discordId.trim();
    if (!DISCORD_ID.test(id)) return "invalid_id";

    const name = label?.trim() ?? "";
    if (name.length > GUEST_LABEL_MAX_LENGTH) return "invalid_label";

    if (this.hosts.includes(id)) return "already_host";
    if ((await this.guests.find(id)) !== null) return "already_guest";

    const request = await this.requests.find(id);
    await this.guests.add({
      discordId: id,
      label:
        name !== "" ? name : request === null ? null : (request.globalName ?? request.username),
      avatarHash: request?.avatarHash ?? null,
      isAdmin: false,
      addedBy,
      addedAt: this.clock.now(),
    });
    if (request !== null) await this.requests.remove(id);
    return "added";
  }
}

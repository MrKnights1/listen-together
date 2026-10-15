import { discordAvatarUrl } from "@/modules/identity/domain/discordAvatar.ts";
import type { Hosts } from "@/modules/identity/domain/Hosts.ts";
import type { AccessRequestRepository } from "@/modules/identity/domain/ports/AccessRequestRepository.ts";
import type { GuestRepository } from "@/modules/identity/domain/ports/GuestRepository.ts";
import type { UserRepository } from "@/modules/identity/domain/ports/UserRepository.ts";

export interface ListedPerson {
  discordId: string;
  name: string;
  avatarUrl: string;
}

export interface ListedGuest extends ListedPerson {
  /** What the admin called them; shown beside their Discord name once they have one. */
  label: string | null;
  isAdmin: boolean;
  addedAt: Date;
  /** False until they first sign in. */
  hasSignedIn: boolean;
}

export interface ListedRequest extends ListedPerson {
  username: string;
  requestedAt: Date;
}

export interface GuestListing {
  hosts: ListedPerson[];
  guests: ListedGuest[];
  requests: ListedRequest[];
}

/**
 * Everything the admin page shows. A person who has signed in is named the way
 * Discord names them now; before that, by what the host typed, else their id.
 */
export class GetGuestList {
  constructor(
    private readonly hosts: Hosts,
    private readonly guests: GuestRepository,
    private readonly requests: AccessRequestRepository,
    private readonly users: UserRepository,
  ) {}

  async execute(): Promise<GuestListing> {
    const hosts = await Promise.all(
      this.hosts.list().map(async (discordId) => {
        const user = await this.users.findByDiscordId(discordId);
        return {
          discordId,
          name: user?.displayName ?? discordId,
          avatarUrl: user?.avatarUrl ?? discordAvatarUrl(discordId, null),
        };
      }),
    );

    const guests = await Promise.all(
      (await this.guests.list()).map(async (guest) => {
        const user = await this.users.findByDiscordId(guest.discordId);
        return {
          discordId: guest.discordId,
          name: user?.displayName ?? guest.label ?? guest.discordId,
          avatarUrl: user?.avatarUrl ?? discordAvatarUrl(guest.discordId, guest.avatarHash),
          label: guest.label,
          isAdmin: guest.isAdmin,
          addedAt: guest.addedAt,
          hasSignedIn: user !== null,
        };
      }),
    );

    const requests = (await this.requests.list()).map((request) => ({
      discordId: request.discordId,
      name: request.globalName ?? request.username,
      avatarUrl: discordAvatarUrl(request.discordId, request.avatarHash),
      username: request.username,
      requestedAt: request.requestedAt,
    }));

    return { hosts, guests, requests };
  }
}

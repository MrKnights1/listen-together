import type { Hosts } from "@/modules/identity/domain/Hosts.ts";
import type { GuestRepository } from "@/modules/identity/domain/ports/GuestRepository.ts";
import type { SessionRepository } from "@/modules/identity/domain/ports/SessionRepository.ts";
import type { UserRepository } from "@/modules/identity/domain/ports/UserRepository.ts";

/** Told the user id of somebody who just lost access, so whatever they have open can close. */
export type AccessRevokedListener = (userId: string) => void;

export type RemoveGuestOutcome = "removed" | "not_found" | "is_host";

/**
 * Takes a guest off the list, and ends everything they have open: their
 * sessions now, and — through the listeners — their place in the room.
 * Hosts are set on the server and cannot be removed here.
 */
export class RemoveGuest {
  private readonly listeners = new Set<AccessRevokedListener>();

  constructor(
    private readonly hosts: Hosts,
    private readonly guests: GuestRepository,
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
  ) {}

  onAccessRevoked(listener: AccessRevokedListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async execute(discordId: string): Promise<RemoveGuestOutcome> {
    if (this.hosts.includes(discordId)) return "is_host";
    if (!(await this.guests.remove(discordId))) return "not_found";

    const user = await this.users.findByDiscordId(discordId);
    if (user === null) return "removed";

    await this.sessions.deleteByUserId(user.id);
    for (const listener of this.listeners) {
      try {
        listener(user.id);
      } catch (error) {
        // The guest is already off the list; a listener failing cannot undo it.
        console.error("An access-revoked listener failed", error);
      }
    }
    return "removed";
  }
}

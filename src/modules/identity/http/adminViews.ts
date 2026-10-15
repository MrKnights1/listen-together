import type { GuestListing } from "@/modules/identity/application/GetGuestList.ts";

/**
 * The admin page's view of the guest list. Unlike `UserView` it carries Discord
 * ids: admins type them in, and only admins ever receive this.
 */
export interface GuestListView {
  hosts: { discordId: string; name: string; avatarUrl: string }[];
  guests: {
    discordId: string;
    name: string;
    avatarUrl: string;
    label: string | null;
    isAdmin: boolean;
    addedAt: string;
    hasSignedIn: boolean;
  }[];
  requests: {
    discordId: string;
    name: string;
    avatarUrl: string;
    username: string;
    requestedAt: string;
  }[];
}

export function toGuestListView(listing: GuestListing): GuestListView {
  return {
    hosts: listing.hosts,
    guests: listing.guests.map((guest) => ({ ...guest, addedAt: guest.addedAt.toISOString() })),
    requests: listing.requests.map((request) => ({
      ...request,
      requestedAt: request.requestedAt.toISOString(),
    })),
  };
}

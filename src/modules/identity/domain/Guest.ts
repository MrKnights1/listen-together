/** Somebody an admin let in, from the admin page. */
export interface Guest {
  discordId: string;
  /** What the admin called them, or their Discord name when they were let in from a request. */
  label: string | null;
  avatarHash: string | null;
  /** May manage the guest list too. */
  isAdmin: boolean;
  /** The Discord id of the admin who let them in. */
  addedBy: string;
  addedAt: Date;
}

/** The longest name an admin may give a guest. */
export const GUEST_LABEL_MAX_LENGTH = 80;

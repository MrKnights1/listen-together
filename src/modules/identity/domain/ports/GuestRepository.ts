import type { Guest } from "@/modules/identity/domain/Guest.ts";

export interface GuestRepository {
  find(discordId: string): Promise<Guest | null>;
  /** Newest first. */
  list(): Promise<Guest[]>;
  /** Adds a guest not already on the list. */
  add(guest: Guest): Promise<void>;
  /** False when there was nobody to change. */
  setAdmin(discordId: string, isAdmin: boolean): Promise<boolean>;
  /** False when there was nobody to remove. */
  remove(discordId: string): Promise<boolean>;
}

import type { AccessRequest } from "@/modules/identity/domain/AccessRequest.ts";

export interface AccessRequestRepository {
  /**
   * Stores a request, or refreshes the name, picture and time of one already
   * waiting. Keeps only the newest `MAX_ACCESS_REQUESTS`.
   */
  record(request: AccessRequest): Promise<void>;
  find(discordId: string): Promise<AccessRequest | null>;
  /** Newest first. */
  list(): Promise<AccessRequest[]>;
  /** False when there was nothing to remove. */
  remove(discordId: string): Promise<boolean>;
  /** Deletes requests made before `cutoff`; returns how many. */
  purgeBefore(cutoff: Date): Promise<number>;
}

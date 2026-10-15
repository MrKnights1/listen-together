import type { AccessRequestRepository } from "@/modules/identity/domain/ports/AccessRequestRepository.ts";

/** Turns a request down by forgetting it. Signing in again asks again. */
export class DeclineAccessRequest {
  constructor(private readonly requests: AccessRequestRepository) {}

  async execute(discordId: string): Promise<"declined" | "not_found"> {
    return (await this.requests.remove(discordId)) ? "declined" : "not_found";
  }
}

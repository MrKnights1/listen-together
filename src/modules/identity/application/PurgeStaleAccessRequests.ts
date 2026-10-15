import type { Clock } from "@/shared/domain/Clock.ts";
import { ACCESS_REQUEST_RETENTION_MS } from "@/modules/identity/domain/AccessRequest.ts";
import type { AccessRequestRepository } from "@/modules/identity/domain/ports/AccessRequestRepository.ts";

/** Forgets requests nobody answered within 30 days: what Discord told us is not kept longer. */
export class PurgeStaleAccessRequests {
  constructor(
    private readonly requests: AccessRequestRepository,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<number> {
    return await this.requests.purgeBefore(
      new Date(this.clock.now().getTime() - ACCESS_REQUEST_RETENTION_MS),
    );
  }
}

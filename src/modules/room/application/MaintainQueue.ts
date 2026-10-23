import type { Clock } from "@/shared/domain/Clock.ts";
import { ACTIVITY_RETENTION_MS } from "@/modules/room/domain/activity.ts";
import { RoomSuspended } from "@/modules/room/domain/errors.ts";
import { trackIdsInUse } from "@/modules/room/domain/RoomState.ts";
import type { ActivityRepository } from "@/modules/room/domain/ports/ActivityRepository.ts";
import type { TrackSource } from "@/modules/room/domain/ports/TrackSource.ts";
import type { RoomEngine } from "./RoomEngine.ts";

export interface QueueMaintenance {
  removed: number;
  purgedActivity: number;
}

/**
 * Daily housekeeping. Tells the catalog which songs are still in use so it can
 * refresh them (and forget the rest), takes out queued songs YouTube no longer
 * plays, and trims the activity feed.
 */
export class MaintainQueue {
  constructor(
    private readonly engine: RoomEngine,
    private readonly trackSource: TrackSource,
    private readonly activity: ActivityRepository,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<QueueMaintenance> {
    const { state } = this.engine.snapshot();
    const entries = Object.values(state.entries);
    // Played songs too: kept fresh in the cache, adding one again asks YouTube nothing.
    const unplayable = new Set(await this.trackSource.maintain(trackIdsInUse(state)));

    let removed = 0;
    for (const entry of entries.filter((one) => unplayable.has(one.trackId))) {
      let decision;
      try {
        decision = await this.engine.execute({ type: "remove", entryId: entry.id }, null, []);
      } catch (error) {
        // The server is shutting down while the catalog answered: the next pass takes over.
        if (error instanceof RoomSuspended) return { removed, purgedActivity: 0 };
        throw error;
      }
      // Somebody may have removed it themselves in the meantime; that is fine.
      if (decision.kind === "accepted") removed += 1;
    }

    const cutoff = this.clock.now().getTime() - ACTIVITY_RETENTION_MS;
    return { removed, purgedActivity: await this.activity.purgeBefore(cutoff) };
  }
}

import type { Clock } from "@/shared/domain/Clock.ts";
import { ACTIVITY_RETENTION_MS } from "@/modules/room/domain/activity.ts";
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
    const entries = Object.values(this.engine.snapshot().state.entries);
    const unplayable = new Set(
      await this.trackSource.maintain([...new Set(entries.map((entry) => entry.trackId))]),
    );

    let removed = 0;
    for (const entry of entries.filter((one) => unplayable.has(one.trackId))) {
      const decision = await this.engine.execute({ type: "remove", entryId: entry.id }, null, []);
      // Somebody may have removed it themselves in the meantime; that is fine.
      if (decision.kind === "accepted") removed += 1;
    }

    const cutoff = this.clock.now().getTime() - ACTIVITY_RETENTION_MS;
    return { removed, purgedActivity: await this.activity.purgeBefore(cutoff) };
  }
}

import type { Clock } from "@/shared/domain/Clock.ts";
import { commit } from "@/modules/room/domain/evolve.ts";
import { RESUME_WINDOW_MS } from "@/modules/room/domain/limits.ts";
import { positionAt } from "@/modules/room/domain/playback.ts";
import type { RoomRepository } from "@/modules/room/domain/ports/RoomRepository.ts";
import type { TrackSource } from "@/modules/room/domain/ports/TrackSource.ts";
import { emptyRoom, type RoomState } from "@/modules/room/domain/RoomState.ts";
import type { RoomEngine } from "./RoomEngine.ts";

/**
 * Brings the room back at boot.
 *
 * A clean shutdown moments ago was a deploy: the room carries on on its
 * original timing, and a song that ended meanwhile is moved past at once by
 * the alarm. Anything else — a crash, a long outage — comes back paused at
 * the position it had when it was last saved, so nobody returns to a song
 * half over with no idea why.
 */
export class RestoreRoom {
  constructor(
    private readonly rooms: RoomRepository,
    private readonly trackSource: TrackSource,
    private readonly engine: RoomEngine,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<RoomState> {
    const now = this.clock.now().getTime();
    const stored = await this.rooms.load();
    let state = stored?.state ?? emptyRoom();

    if (stored !== null && state.current?.status === "playing") {
      const deploy = stored.cleanShutdown && now - stored.savedAt < RESUME_WINDOW_MS;
      if (!deploy) {
        const positionMs = positionAt(state, stored.savedAt);
        state = commit(state, [{ type: "paused", positionMs, at: now }]);
      }
    }

    const trackIds = [...new Set(Object.values(state.entries).map((entry) => entry.trackId))];
    this.engine.load(state, await this.trackSource.describe(trackIds));
    // Saved straight away, so the clean-shutdown mark cannot be reused by a later crash.
    await this.rooms.save(state, now, false);
    return state;
  }
}

import { RECENT_ACTIVITY, type ActivityEntry } from "@/modules/room/domain/activity.ts";
import type { ActivityRepository } from "@/modules/room/domain/ports/ActivityRepository.ts";
import type { RoomState } from "@/modules/room/domain/RoomState.ts";
import type { TrackInfo } from "@/modules/room/domain/TrackInfo.ts";
import type { RoomEngine } from "./RoomEngine.ts";

export interface RoomView {
  state: RoomState;
  tracks: TrackInfo[];
  activity: ActivityEntry[];
}

/** Everything somebody joining needs to see the room as it is. */
export class GetRoomView {
  constructor(
    private readonly engine: RoomEngine,
    private readonly activity: ActivityRepository,
  ) {}

  async execute(): Promise<RoomView> {
    const { state, tracks } = this.engine.snapshot();
    return { state, tracks, activity: await this.activity.recent(RECENT_ACTIVITY) };
  }
}

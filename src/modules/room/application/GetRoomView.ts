import { RECENT_ACTIVITY, type ActivityEntry } from "@/modules/room/domain/activity.ts";
import type { Person } from "@/modules/room/domain/Person.ts";
import type { ActivityRepository } from "@/modules/room/domain/ports/ActivityRepository.ts";
import { ownerIdsInView, type RoomState } from "@/modules/room/domain/RoomState.ts";
import type { TrackInfo } from "@/modules/room/domain/TrackInfo.ts";
import type { DescribePeople } from "./DescribePeople.ts";
import type { RoomEngine } from "./RoomEngine.ts";

export interface RoomView {
  state: RoomState;
  tracks: TrackInfo[];
  activity: ActivityEntry[];
  /** Everyone the view mentions: whoever queued a song, whoever acted in the feed, and `alsoPeople`. */
  people: Person[];
}

/** Everything somebody joining needs to see the room as it is. */
export class GetRoomView {
  constructor(
    private readonly engine: RoomEngine,
    private readonly activity: ActivityRepository,
    private readonly describePeople: DescribePeople,
  ) {}

  async execute(alsoPeople: string[]): Promise<RoomView> {
    const activity = await this.activity.recent(RECENT_ACTIVITY);
    const owners = ownerIdsInView(this.engine.snapshot().state);
    const actors = activity.flatMap((entry) => (entry.actorId === null ? [] : [entry.actorId]));
    const people = await this.describePeople.execute([...owners, ...actors, ...alsoPeople]);

    // Taken last, after every await, so it is the room as of the moment this returns.
    const { state, tracks } = this.engine.snapshot();
    return { state, tracks, activity, people };
  }
}

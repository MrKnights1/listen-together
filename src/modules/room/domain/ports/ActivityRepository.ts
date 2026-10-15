import type { ActivityEntry, NewActivity } from "@/modules/room/domain/activity.ts";

export interface ActivityRepository {
  record(activity: NewActivity): Promise<ActivityEntry>;
  /** The latest `limit` entries, oldest first. */
  recent(limit: number): Promise<ActivityEntry[]>;
  /** Deletes entries from before `cutoff` and says how many. */
  purgeBefore(cutoff: number): Promise<number>;
}

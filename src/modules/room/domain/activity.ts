import type { RoomCommand } from "./commands.ts";
import type { AddOutcome } from "./decide.ts";
import { queuedUpTo, type RepeatMode, type RoomState } from "./RoomState.ts";

export type ActivityKind =
  | "added"
  | "skipped"
  | "removed"
  | "auto_removed"
  | "paused"
  | "auto_paused"
  | "resumed"
  | "seeked"
  | "moved"
  | "cleared"
  | "shuffled"
  | "repeat_set"
  | "shuffle_set";

export interface ActivityDetail {
  count?: number;
  trackId?: string;
  /** Copied at the time: the song may be gone from the room by the time anyone reads this. */
  title?: string;
  positionMs?: number;
  mode?: RepeatMode;
  /** Null on lines from before shuffle became a switch: the whole queue was shuffled once. */
  ownerId?: string | null;
  on?: boolean;
}

export interface NewActivity {
  at: number;
  /** Null when the room did it itself: auto-pause, an unavailable song removed. */
  actorId: string | null;
  kind: ActivityKind;
  detail: ActivityDetail;
}

export interface ActivityEntry extends NewActivity {
  id: number;
}

/** How long the feed remembers. */
export const ACTIVITY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** How many recent entries a newly connected listener is shown. */
export const RECENT_ACTIVITY = 50;

/**
 * The feed line for a command that changed the room, or null for changes
 * nobody needs telling about — a song simply ending is the room working.
 * Read against the room *before* the command, so a removed song still has
 * its title.
 */
export function describeActivity(
  before: RoomState,
  command: RoomCommand,
  add: AddOutcome | undefined,
  actorId: string | null,
  titleOf: (trackId: string) => string | undefined,
  at: number,
): NewActivity | null {
  const about = (entryId: string): ActivityDetail => {
    const trackId = before.entries[entryId]?.trackId;
    if (trackId === undefined) return {};
    const title = titleOf(trackId);
    return title === undefined ? { trackId } : { trackId, title };
  };
  const line = (kind: ActivityKind, detail: ActivityDetail = {}): NewActivity => ({
    at,
    actorId,
    kind,
    detail,
  });

  switch (command.type) {
    case "add":
      return line("added", { count: add?.added.length ?? 0 });
    case "skip":
      return line("skipped", about(command.entryId));
    case "remove":
      return line(actorId === null ? "auto_removed" : "removed", about(command.entryId));
    case "pause":
      return line("paused");
    case "auto_pause":
      return line("auto_paused");
    case "resume":
      return line("resumed");
    case "seek":
      return line("seeked", { positionMs: Math.round(command.positionMs) });
    case "move":
      return line("moved", about(command.entryId));
    case "clear":
      return line("cleared", { count: queuedUpTo(before, command.addedUpTo).length });
    case "shuffle":
      return line("shuffled", { ownerId: command.ownerId });
    case "repeat":
      return line("repeat_set", { mode: command.mode });
    case "set_shuffle":
      return line("shuffle_set", { on: command.on });
    case "track_ended":
      return null;
  }
}

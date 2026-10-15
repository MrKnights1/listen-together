import type { RoomCommand, TrackToQueue } from "./commands.ts";
import type { RoomEvent } from "./events.ts";
import { MAX_LANE_ENTRIES, MAX_ROOM_ENTRIES } from "./limits.ts";
import { positionAt } from "./playback.ts";
import type { Random } from "./ports/Random.ts";
import { laneOf, type QueueEntry, type RoomState } from "./RoomState.ts";

/**
 * `stale`: the command named a song that is no longer where the sender saw
 * it. `invalid`: the command can never apply, e.g. moving the song playing.
 */
export type RejectionCode = "stale" | "invalid";

/** What an `add` did with each song it was given. */
export interface AddOutcome {
  added: string[];
  /** Track ids already queued by this person, or playing right now. */
  duplicates: string[];
  /** How many were left out because the person's list or the room was full. */
  overflow: number;
}

export type Decision =
  | { kind: "accepted"; events: RoomEvent[]; add?: AddOutcome }
  | { kind: "rejected"; code: RejectionCode };

export interface DecisionContext {
  now: number;
  random: Random;
}

const accepted = (events: RoomEvent[]): Decision => ({ kind: "accepted", events });
const rejected = (code: RejectionCode): Decision => ({ kind: "rejected", code });

/** True when the command names the song everybody is on right now. */
function isCurrent(state: RoomState, entryId: string): boolean {
  return state.current?.entryId === entryId;
}

function decideAdd(
  state: RoomState,
  ownerId: string,
  tracks: TrackToQueue[],
  now: number,
): Decision {
  const lane = state.lanes[ownerId] ?? [];
  const taken = new Set(lane.map((id) => state.entries[id]?.trackId));
  const playing = state.current === null ? undefined : state.entries[state.current.entryId];
  if (playing !== undefined) taken.add(playing.trackId);

  let room = MAX_ROOM_ENTRIES - Object.keys(state.entries).length;
  let space = MAX_LANE_ENTRIES - lane.length;
  const entries: QueueEntry[] = [];
  const duplicates: string[] = [];
  let overflow = 0;

  for (const track of tracks) {
    if (taken.has(track.trackId)) {
      duplicates.push(track.trackId);
    } else if (room <= 0 || space <= 0) {
      overflow += 1;
    } else {
      taken.add(track.trackId);
      entries.push({
        id: track.entryId,
        ownerId,
        trackId: track.trackId,
        durationMs: track.durationMs,
        addedAt: now,
      });
      room -= 1;
      space -= 1;
    }
  }

  const events: RoomEvent[] = entries.length === 0 ? [] : [{ type: "queued", entries }];
  // An idle room starts on its own the moment there is something to play.
  if (entries.length > 0 && state.current === null) {
    events.push({ type: "advanced", reason: "started", at: now });
  }

  return {
    kind: "accepted",
    events,
    add: { added: entries.map((entry) => entry.id), duplicates, overflow },
  };
}

/** Fisher–Yates over a copy: every order equally likely, given a fair `Random`. */
function shuffled(lane: string[], random: Random): string[] {
  const copy = [...lane];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = random.int(index + 1);
    [copy[index], copy[other]] = [copy[other] as string, copy[index] as string];
  }
  return copy;
}

/**
 * Decides what a command does to the room, without changing it. Pure: the
 * clock and chance arrive in `context`, so every outcome can be tested by
 * choosing them.
 */
export function decide(state: RoomState, command: RoomCommand, context: DecisionContext): Decision {
  const { now } = context;

  switch (command.type) {
    case "add":
      return decideAdd(state, command.ownerId, command.tracks, now);

    case "pause":
      if (!isCurrent(state, command.entryId)) return rejected("stale");
      if (state.current?.status === "paused") return accepted([]);
      return accepted([{ type: "paused", positionMs: positionAt(state, now), at: now }]);

    case "resume":
      if (!isCurrent(state, command.entryId)) return rejected("stale");
      if (state.current?.status === "playing") return accepted([]);
      return accepted([{ type: "resumed", at: now }]);

    case "seek": {
      if (!isCurrent(state, command.entryId)) return rejected("stale");
      if (!Number.isFinite(command.positionMs)) return rejected("invalid");
      const durationMs = state.entries[command.entryId]?.durationMs ?? 0;
      const positionMs = Math.round(Math.min(Math.max(command.positionMs, 0), durationMs));
      return accepted([{ type: "seeked", positionMs, at: now }]);
    }

    case "skip":
      if (!isCurrent(state, command.entryId)) return rejected("stale");
      return accepted([{ type: "advanced", reason: "skipped", at: now }]);

    case "remove":
      if (isCurrent(state, command.entryId)) {
        return accepted([{ type: "advanced", reason: "removed", at: now }]);
      }
      if (laneOf(state, command.entryId) === null) return rejected("stale");
      return accepted([{ type: "removed", entryId: command.entryId }]);

    case "move": {
      if (isCurrent(state, command.entryId)) return rejected("invalid");
      if (!Number.isInteger(command.toIndex)) return rejected("invalid");
      const place = laneOf(state, command.entryId);
      if (place === null) return rejected("stale");
      const laneLength = state.lanes[place.ownerId]?.length ?? 0;
      const toIndex = Math.min(Math.max(command.toIndex, 0), laneLength - 1);
      if (toIndex === place.index) return accepted([]);
      return accepted([{ type: "moved", entryId: command.entryId, toIndex }]);
    }

    case "shuffle": {
      const owners = command.ownerId === null ? Object.keys(state.lanes) : [command.ownerId];
      const lanes: Record<string, string[]> = {};
      for (const ownerId of owners) {
        const lane = state.lanes[ownerId];
        if (lane !== undefined && lane.length > 1) lanes[ownerId] = shuffled(lane, context.random);
      }
      return Object.keys(lanes).length === 0
        ? accepted([])
        : accepted([{ type: "shuffled", lanes }]);
    }

    case "repeat":
      return state.repeat === command.mode
        ? accepted([])
        : accepted([{ type: "repeat_set", mode: command.mode }]);

    case "track_ended":
      // The alarm is re-armed after every command, but a stale one must still
      // never cut a song short: it has only ended if the clock says so.
      if (!isCurrent(state, command.entryId) || state.current?.status !== "playing") {
        return rejected("stale");
      }
      if (positionAt(state, now) < (state.entries[command.entryId]?.durationMs ?? 0)) {
        return rejected("stale");
      }
      return accepted([{ type: "advanced", reason: "ended", at: now }]);

    case "auto_pause":
      if (state.current?.status !== "playing") return accepted([]);
      return accepted([{ type: "paused", positionMs: positionAt(state, now), at: now }]);
  }
}
